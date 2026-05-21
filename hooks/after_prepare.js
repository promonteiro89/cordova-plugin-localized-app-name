#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[localized-app-name]';

const ANDROID_STRING_KEYS = ['app_name', 'launcher_name', 'activity_name'];
const LOCALE_FILENAME_PATTERN = /^[a-zA-Z]{2,3}([-_][a-zA-Z0-9]+)*\.json$/;

function log(msg)  { console.log(`${LOG_PREFIX} ${msg}`); }
function warn(msg) { console.warn(`${LOG_PREFIX} WARN: ${msg}`); }
function err(msg)  { console.error(`${LOG_PREFIX} ERROR: ${msg}`); }

module.exports = function (context) {
    try {
        const projectRoot = context.opts.projectRoot;
        const discovery = findTranslationsDir(projectRoot);
        if (!discovery) {
            log('No locale JSON files found in any known location, skipping.');
            return;
        }

        log(`Reading locale files from ${path.relative(projectRoot, discovery.dir) || '.'} (${discovery.files.length} file(s): ${discovery.files.join(', ')})`);

        const entries = discovery.files
            .map(file => {
                const locale = path.basename(file, path.extname(file));
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(discovery.dir, file), 'utf8'));
                    return { locale, data };
                } catch (e) {
                    err(`Failed to parse ${file}: ${e.message}`);
                    return null;
                }
            })
            .filter(Boolean);

        writeIos(projectRoot, entries);
        writeAndroid(projectRoot, entries);
    } catch (e) {
        err(`Hook crashed: ${e.stack || e.message}`);
    }
};

function findTranslationsDir(projectRoot) {
    const candidates = [
        path.join(projectRoot, 'translations', 'app'),
        path.join(projectRoot, 'www', 'translations', 'app'),
        path.join(projectRoot, 'www'),
        path.join(projectRoot, 'platforms', 'android', 'app', 'src', 'main', 'assets', 'www'),
        path.join(projectRoot, 'platforms', 'android', 'assets', 'www'),
        path.join(projectRoot, 'platforms', 'ios', 'www'),
    ];

    for (const dir of candidates) {
        if (!fs.existsSync(dir)) continue;
        try {
            const files = fs.readdirSync(dir).filter(f => isLocaleFile(dir, f));
            if (files.length > 0) return { dir, files };
        } catch (e) {
            err(`cannot read ${dir}: ${e.message}`);
        }
    }
    return null;
}

function isLocaleFile(dir, filename) {
    if (!LOCALE_FILENAME_PATTERN.test(filename)) return false;
    try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, filename), 'utf8'));
        return Boolean(data && (data.config_ios || data.config_android));
    } catch {
        return false;
    }
}

function writeIos(projectRoot, entries) {
    const iosDir = path.join(projectRoot, 'platforms', 'ios');
    if (!fs.existsSync(iosDir)) {
        log('iOS: platforms/ios not present, skipping.');
        return;
    }

    const appFolder = findIosAppFolder(iosDir);
    if (!appFolder) {
        warn('iOS: could not locate the app folder (no *-Info.plist), skipping.');
        return;
    }

    const writtenLocales = [];
    for (const { locale, data } of entries) {
        const displayName = data.config_ios && data.config_ios.CFBundleDisplayName;
        if (!displayName) continue;

        const lprojDir = path.join(appFolder, `${locale}.lproj`);
        fs.mkdirSync(lprojDir, { recursive: true });

        const escaped = escapeStringsValue(displayName);
        const contents =
            `"CFBundleDisplayName" = "${escaped}";\n` +
            `"CFBundleName" = "${escaped}";\n`;

        fs.writeFileSync(path.join(lprojDir, 'InfoPlist.strings'), contents, 'utf8');
        log(`iOS  -> ${locale}.lproj/InfoPlist.strings = "${displayName}"`);
        writtenLocales.push(locale);
    }
    log(`iOS: wrote ${writtenLocales.length} locale file(s).`);

    if (writtenLocales.length > 0) {
        registerIosLocalizations(iosDir, path.basename(appFolder), writtenLocales);
    }
}

// Register the per-locale InfoPlist.strings files in the Xcode project so
// xcodebuild bundles them. Without this, files exist on disk but never make
// it into the .app, and the home-screen label stays the default.
//
// appFolderName is the basename of the on-disk app folder (e.g. "App" on
// cordova-ios 8.x, "<ProjectName>" on older versions). We need the variant
// group attached to the matching Xcode group so file paths resolve correctly.
function registerIosLocalizations(iosDir, appFolderName, locales) {
    const pbxprojPath = findPbxproj(iosDir);
    if (!pbxprojPath) {
        warn('iOS: no project.pbxproj found, skipping Xcode registration.');
        return;
    }

    let xcode;
    try {
        xcode = require('xcode');
    } catch {
        warn('iOS: "xcode" npm package not found. Skipping Xcode registration. Install cordova-ios >= 4.x or add "xcode" to your project.');
        return;
    }

    const proj = xcode.project(pbxprojPath);
    proj.parseSync();

    dumpTargetsAndPhases(proj, 'before');

    const variantGroupUuid = findOrCreateVariantGroup(proj, 'InfoPlist.strings', appFolderName);
    const existingLocales = listVariantGroupLocales(proj, variantGroupUuid);

    let added = 0;
    for (const locale of locales) {
        if (existingLocales.has(locale)) continue;
        addLocaleToVariantGroup(proj, variantGroupUuid, locale, appFolderName);
        added++;
    }

    fs.writeFileSync(pbxprojPath, proj.writeSync());
    log(`iOS: registered ${added} locale(s) in Xcode project (variant group: InfoPlist.strings).`);

    dumpVariantGroupState(proj, variantGroupUuid);
    dumpTargetsAndPhases(proj, 'after');
}

function dumpTargetsAndPhases(proj, label) {
    try {
        const targets = proj.hash.project.objects.PBXNativeTarget || {};
        log(`iOS DIAG (${label}): native targets:`);
        for (const key of Object.keys(targets)) {
            if (key.endsWith('_comment')) continue;
            const t = targets[key];
            const name = (t.name || '').replace(/^"|"$/g, '');
            const productType = (t.productType || '').replace(/^"|"$/g, '');
            const phases = (t.buildPhases || []).map(p => p.comment).join(', ');
            log(`  - ${key} name="${name}" productType="${productType}" phases=[${phases}]`);
        }
        const resPhases = proj.hash.project.objects.PBXResourcesBuildPhase || {};
        log(`iOS DIAG (${label}): PBXResourcesBuildPhase entries:`);
        for (const key of Object.keys(resPhases)) {
            if (key.endsWith('_comment')) continue;
            const p = resPhases[key];
            const files = (p.files || []).map(f => f.comment).join(', ');
            log(`  - ${key} files=[${files}]`);
        }
    } catch (e) {
        warn(`iOS DIAG dump failed (${label}): ${e.message}`);
    }
}

function dumpVariantGroupState(proj, variantGroupUuid) {
    try {
        const variantGroups = proj.hash.project.objects.PBXVariantGroup || {};
        const vg = variantGroups[variantGroupUuid];
        if (!vg) {
            warn(`iOS DIAG: variant group ${variantGroupUuid} missing from PBXVariantGroup section!`);
            return;
        }
        const children = (vg.children || []).map(c => `${c.value}=${c.comment}`).join(', ');
        log(`iOS DIAG: variant group ${variantGroupUuid} name="${(vg.name || '').replace(/^"|"$/g, '')}" children=[${children}]`);

        const groups = proj.hash.project.objects.PBXGroup || {};
        let parentInfo = 'NONE (orphaned!)';
        for (const gKey of Object.keys(groups)) {
            if (gKey.endsWith('_comment')) continue;
            const g = groups[gKey];
            if (!Array.isArray(g.children)) continue;
            const match = g.children.find(c => c && c.value === variantGroupUuid);
            if (match) {
                const rawName = (g.name || '').replace(/^"|"$/g, '') || '(unset)';
                const rawPath = (g.path || '').replace(/^"|"$/g, '') || '(unset)';
                parentInfo = `${gKey} name="${rawName}" path="${rawPath}"`;
                break;
            }
        }
        log(`iOS DIAG: variant group's parent PBXGroup: ${parentInfo}`);

        const buildFiles = proj.hash.project.objects.PBXBuildFile || {};
        const matchingBuildFile = Object.keys(buildFiles)
            .filter(k => !k.endsWith('_comment'))
            .find(k => buildFiles[k] && buildFiles[k].fileRef === variantGroupUuid);
        log(`iOS DIAG: PBXBuildFile entry for variant group: ${matchingBuildFile || 'MISSING'}`);

        if (matchingBuildFile) {
            const resPhases = proj.hash.project.objects.PBXResourcesBuildPhase || {};
            const inPhases = [];
            for (const pKey of Object.keys(resPhases)) {
                if (pKey.endsWith('_comment')) continue;
                const p = resPhases[pKey];
                if ((p.files || []).some(f => f && f.value === matchingBuildFile)) inPhases.push(pKey);
            }
            log(`iOS DIAG: PBXBuildFile present in resources build phase(s): ${inPhases.join(', ') || 'NONE'}`);
        }
    } catch (e) {
        warn(`iOS DIAG dump failed: ${e.message}`);
    }
}

function findPbxproj(iosDir) {
    const entries = fs.readdirSync(iosDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory() && entry.name.endsWith('.xcodeproj')) {
            const p = path.join(iosDir, entry.name, 'project.pbxproj');
            if (fs.existsSync(p)) return p;
        }
    }
    return null;
}

function findOrCreateVariantGroup(proj, name, appFolderName) {
    const section = proj.hash.project.objects.PBXVariantGroup || {};
    for (const key of Object.keys(section)) {
        if (key.endsWith('_comment')) continue;
        const entry = section[key];
        const entryName = entry && (entry.name || '').replace(/^"|"$/g, '');
        if (entryName === name) {
            log(`iOS: reusing existing "${name}" variant group (${key})`);
            return key;
        }
    }
    // Replicate xcode pkg's addLocalizationVariantGroup but attach to the group
    // that maps to the app folder on disk (where our .lproj files live), so
    // file paths with sourceTree="<group>" resolve correctly. cordova-ios 8.x
    // uses "App"; older cordova-ios and OutSystems MABS use "<ProjectName>".
    const variantGroupKey = proj.pbxCreateVariantGroup(name);
    const hostInfo = findAppHostGroup(proj, appFolderName);
    if (hostInfo) {
        proj.addToPbxGroup(variantGroupKey, hostInfo.key);
        log(`iOS: attached variant group to "${hostInfo.label}" (${hostInfo.key}) via ${hostInfo.via}`);
    } else {
        warn(`iOS: could not find a suitable host group for variant group (tried Info.plist parent, "${appFolderName}", App, Resources).`);
    }

    const buildFileEntry = {
        uuid: proj.generateUuid(),
        fileRef: variantGroupKey,
        basename: name,
    };
    proj.addToPbxBuildFileSection(buildFileEntry);
    proj.addToPbxResourcesBuildPhase(buildFileEntry);

    return variantGroupKey;
}

// Find the Xcode group that should host the InfoPlist.strings variant group.
// Best strategy: find the group that already contains the project's Info.plist
// file reference — by definition that group's path resolves to where Info.plist
// lives, which is the same folder where our .lproj/InfoPlist.strings live.
function findAppHostGroup(proj, appFolderName) {
    // Strategy 1: find the group containing the Info.plist file reference.
    const fileRefs = proj.hash.project.objects.PBXFileReference || {};
    let infoPlistRefKey = null;
    for (const key of Object.keys(fileRefs)) {
        if (key.endsWith('_comment')) continue;
        const ref = fileRefs[key];
        const refPath = (ref && ref.path || '').replace(/^"|"$/g, '');
        if (/(^|\/)([^/]+-)?Info\.plist$/.test(refPath)) {
            infoPlistRefKey = key;
            break;
        }
    }
    if (infoPlistRefKey) {
        const groups = proj.hash.project.objects.PBXGroup || {};
        for (const groupKey of Object.keys(groups)) {
            if (groupKey.endsWith('_comment')) continue;
            const group = groups[groupKey];
            if (!group || !Array.isArray(group.children)) continue;
            for (const child of group.children) {
                if (child && child.value === infoPlistRefKey) {
                    const label = (group.name || group.path || '').replace(/^"|"$/g, '') || groupKey;
                    return { key: groupKey, label, via: 'Info.plist parent group' };
                }
            }
        }
    }

    // Strategy 2: fall back to known group names.
    const candidates = [
        { q: { path: appFolderName }, via: `path == "${appFolderName}"` },
        { q: { name: appFolderName }, via: `name == "${appFolderName}"` },
        { q: { name: 'App' },         via: 'name == "App"' },
        { q: { path: 'App' },         via: 'path == "App"' },
        { q: { name: 'Resources' },   via: 'name == "Resources" (last resort)' },
    ];
    for (const c of candidates) {
        const key = proj.findPBXGroupKey(c.q);
        if (key) return { key, label: Object.values(c.q)[0], via: c.via };
    }
    return null;
}

function listVariantGroupLocales(proj, variantGroupUuid) {
    const section = proj.hash.project.objects.PBXVariantGroup || {};
    const group = section[variantGroupUuid];
    const locales = new Set();
    if (!group || !Array.isArray(group.children)) return locales;
    for (const child of group.children) {
        if (child && child.comment) locales.add(child.comment);
    }
    return locales;
}

function addLocaleToVariantGroup(proj, variantGroupUuid, locale, appFolderName) {
    const fileRefUuid = require('crypto').randomBytes(12).toString('hex').toUpperCase();
    const fileRefs = proj.hash.project.objects.PBXFileReference;
    // Use SOURCE_ROOT-relative paths to bypass any quirks of group path
    // inheritance. SOURCE_ROOT == platforms/ios/ (the .xcodeproj's parent).
    // Our .lproj files live at platforms/ios/<appFolderName>/<locale>.lproj/.
    const relPath = `${appFolderName}/${locale}.lproj/InfoPlist.strings`;
    fileRefs[fileRefUuid] = {
        isa: 'PBXFileReference',
        fileEncoding: 4,
        lastKnownFileType: 'text.plist.strings',
        name: `"${locale}"`,
        path: `"${relPath}"`,
        sourceTree: 'SOURCE_ROOT',
    };
    fileRefs[fileRefUuid + '_comment'] = locale;
    proj.addToPbxVariantGroup({ fileRef: fileRefUuid, basename: locale }, variantGroupUuid);
}

function writeAndroid(projectRoot, entries) {
    const resDir = resolveAndroidResDir(projectRoot);
    if (!resDir) {
        log('Android: no platforms/android res directory found, skipping.');
        return;
    }

    let wrote = 0;
    for (const { locale, data } of entries) {
        const appName = data.config_android && data.config_android.app_name;
        if (!appName) continue;

        const androidLocale = toAndroidLocale(locale);
        const valuesDir = path.join(resDir, `values-${androidLocale}`);
        fs.mkdirSync(valuesDir, { recursive: true });

        const stringsPath = path.join(valuesDir, 'strings.xml');
        let xml = fs.existsSync(stringsPath)
            ? fs.readFileSync(stringsPath, 'utf8')
            : `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n`;

        for (const key of ANDROID_STRING_KEYS) {
            xml = upsertAndroidString(xml, key, appName);
        }

        fs.writeFileSync(stringsPath, xml, 'utf8');
        log(`Android -> values-${androidLocale}/strings.xml = "${appName}"`);
        wrote++;
    }
    log(`Android: wrote ${wrote} locale file(s).`);
}

function resolveAndroidResDir(projectRoot) {
    const candidates = [
        path.join(projectRoot, 'platforms', 'android', 'app', 'src', 'main', 'res'),
        path.join(projectRoot, 'platforms', 'android', 'res'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

function upsertAndroidString(xml, key, value) {
    const escaped = escapeXmlValue(value);
    const keyPattern = new RegExp(`<string\\s+name="${key}"\\s*>[\\s\\S]*?</string>`);
    if (keyPattern.test(xml)) {
        return xml.replace(keyPattern, `<string name="${key}">${escaped}</string>`);
    }
    return xml.replace(/<\/resources>/, `    <string name="${key}">${escaped}</string>\n</resources>`);
}

function findIosAppFolder(iosDir) {
    const entries = fs.readdirSync(iosDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(iosDir, entry.name);
        try {
            const plistMatch = fs.readdirSync(candidate).some(f => f.endsWith('-Info.plist'));
            if (plistMatch) return candidate;
        } catch { /* skip */ }
    }
    return null;
}

function toAndroidLocale(locale) {
    const parts = locale.split(/[-_]/);
    if (parts.length === 1) return parts[0];
    if (parts.length === 2 && parts[1].length === 2) {
        return `${parts[0]}-r${parts[1].toUpperCase()}`;
    }
    return parts[0];
}

function escapeStringsValue(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function escapeXmlValue(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '\\\'');
}
