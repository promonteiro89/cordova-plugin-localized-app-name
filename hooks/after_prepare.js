#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[localized-app-name]';

const ANDROID_STRING_KEYS = ['app_name', 'launcher_name', 'activity_name'];
const LOCALE_FILENAME_PATTERN = /^[a-zA-Z]{2,3}([-_][a-zA-Z0-9]+)*\.json$/;

// Global config.xml preference for the fallback name (see README).
const DEFAULT_NAME_PREFERENCE = 'AppDefaultName';

function log(msg)  { console.log(`${LOG_PREFIX} ${msg}`); }
function warn(msg) { console.warn(`${LOG_PREFIX} WARN: ${msg}`); }
function err(msg)  { console.error(`${LOG_PREFIX} ERROR: ${msg}`); }

module.exports = function (context) {
    try {
        const projectRoot = context.opts.projectRoot;

        const appDefaultName = readGlobalPreference(projectRoot, DEFAULT_NAME_PREFERENCE);
        const discovery = findTranslationsDir(projectRoot);

        if (!discovery && !appDefaultName) {
            log(`No locale JSON files found and no ${DEFAULT_NAME_PREFERENCE} preference set, skipping.`);
            return;
        }

        let entries = [];
        if (discovery) {
            log(`Reading locale files from ${path.relative(projectRoot, discovery.dir) || '.'} (${discovery.files.length} file(s): ${discovery.files.join(', ')})`);
            entries = discovery.files
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
        }

        if (appDefaultName) {
            log(`Default app name (${DEFAULT_NAME_PREFERENCE}) = "${appDefaultName}".`);
        }

        writeIos(projectRoot, entries, appDefaultName);
        writeAndroid(projectRoot, entries, appDefaultName);
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

// <platform> blocks are stripped first so a per-platform preference of the same
// name can't match — the value applies to both platforms. Regex rather than an
// XML parser to keep the hook dependency-free.
function readGlobalPreference(projectRoot, prefName) {
    const configPath = path.join(projectRoot, 'config.xml');
    if (!fs.existsSync(configPath)) return null;

    let xml;
    try {
        xml = fs.readFileSync(configPath, 'utf8');
    } catch (e) {
        warn(`could not read config.xml: ${e.message}`);
        return null;
    }

    const globalXml = xml.replace(/<platform\b[\s\S]*?<\/platform>/gi, '');
    const tagPattern = /<preference\b([^>]*)>/gi;
    let match;
    while ((match = tagPattern.exec(globalXml)) !== null) {
        const attrs = match[1].replace(/\/\s*$/, '');
        const name = readAttr(attrs, 'name');
        if (name && name.toLowerCase() === prefName.toLowerCase()) {
            const value = readAttr(attrs, 'value');
            return value && value.trim() ? value.trim() : null;
        }
    }
    return null;
}

function readAttr(attrs, key) {
    const m = new RegExp(`\\b${key}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs);
    if (!m) return null;
    return decodeXmlEntities(m[2] !== undefined ? m[2] : m[3]);
}

// config.xml values are XML-encoded; decode before use so re-escaping when we
// write the plist / strings.xml doesn't double-encode (&amp; -> &amp;amp;).
// &amp; is decoded last so "&amp;lt;" stays "&lt;".
function decodeXmlEntities(s) {
    return String(s)
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function writeIos(projectRoot, entries, appDefaultName) {
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

    // Files go under <appFolder>/Resources/<locale>.lproj/ to match the
    // structure cordova-ios's xcodeproj already expects (its Resources group
    // points there). The resource path used in pbxproj is either
    // "Resources/<locale>.lproj/InfoPlist.strings" (cordova-ios <= 7) or
    // "App/Resources/<locale>.lproj/InfoPlist.strings" (cordova-ios 8.x).
    const isCordovaIos8 = fs.existsSync(path.join(iosDir, 'App.xcodeproj'));
    const resourcePathPrefix = isCordovaIos8 ? 'App/Resources' : 'Resources';

    const writtenLocaleResources = [];
    for (const { locale, data } of entries) {
        const displayName = data.config_ios && data.config_ios.CFBundleDisplayName;
        if (!displayName) continue;

        const lprojDir = path.join(appFolder, 'Resources', `${locale}.lproj`);
        fs.mkdirSync(lprojDir, { recursive: true });

        const escaped = escapeStringsValue(displayName);
        const contents =
            `"CFBundleDisplayName" = "${escaped}";\n` +
            `"CFBundleName" = "${escaped}";\n`;

        fs.writeFileSync(path.join(lprojDir, 'InfoPlist.strings'), contents, 'utf8');
        const resourcePath = `${resourcePathPrefix}/${locale}.lproj/InfoPlist.strings`;
        log(`iOS  -> ${locale}.lproj/InfoPlist.strings = "${displayName}"`);
        writtenLocaleResources.push(resourcePath);
    }
    log(`iOS: wrote ${writtenLocaleResources.length} locale file(s).`);

    if (writtenLocaleResources.length > 0) {
        registerIosLocalizations(projectRoot, iosDir, writtenLocaleResources);
    }

    if (appDefaultName) {
        applyIosDefaultName(appFolder, appDefaultName);
    }
}

// iOS's fallback display name (when no *.lproj matches) is CFBundleDisplayName /
// CFBundleName in the main Info.plist. Written in after_prepare, after
// cordova-ios generates the plist, so our value wins. No cache purge needed: the
// plist isn't cached the way the pbxproj is.
function applyIosDefaultName(appFolder, appDefaultName) {
    const plistPath = findIosInfoPlist(appFolder);
    if (!plistPath) {
        warn('iOS: no *-Info.plist found, cannot set default app name.');
        return;
    }

    try {
        let xml = fs.readFileSync(plistPath, 'utf8');
        xml = upsertPlistString(xml, 'CFBundleDisplayName', appDefaultName);
        xml = upsertPlistString(xml, 'CFBundleName', appDefaultName);
        fs.writeFileSync(plistPath, xml, 'utf8');
        log(`iOS: set default CFBundleDisplayName/CFBundleName = "${appDefaultName}" in ${path.basename(plistPath)}.`);
    } catch (e) {
        warn(`iOS: could not set default app name in Info.plist: ${e.message}`);
    }
}

function findIosInfoPlist(appFolder) {
    try {
        const file = fs.readdirSync(appFolder).find(f => f.endsWith('-Info.plist'));
        return file ? path.join(appFolder, file) : null;
    } catch {
        return null;
    }
}

// Replaces the key's value if present, else inserts the pair before the root
// dict's close (the last </dict> in the file).
function upsertPlistString(xml, key, value) {
    const escapedValue = escapePlistValue(value);
    const keyPattern = new RegExp(`(<key>${escapeRegExp(key)}</key>\\s*<string>)[\\s\\S]*?(</string>)`);
    if (keyPattern.test(xml)) {
        return xml.replace(keyPattern, `$1${escapedValue}$2`);
    }

    const lastDictClose = xml.lastIndexOf('</dict>');
    if (lastDictClose === -1) {
        warn(`iOS: Info.plist has no </dict>; left "${key}" unset.`);
        return xml;
    }
    const insertion = `\t<key>${key}</key>\n\t<string>${escapedValue}</string>\n`;
    return xml.slice(0, lastDictClose) + insertion + xml.slice(lastDictClose);
}

// Register the per-locale InfoPlist.strings files in the Xcode project so
// xcodebuild bundles them. Without this, files exist on disk but never make
// it into the .app, and the home-screen label stays the default.
//
// CRITICAL: after writing the pbxproj, we must purge cordova-ios's in-memory
// project file cache. Otherwise cordova-ios's later operations (e.g.
// ProvisioningProfile signing setup) write their stale cached pbxproj copy
// back to disk, silently undoing our edits.
function registerIosLocalizations(projectRoot, iosDir, resourcePaths) {
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

    // Find or create the InfoPlist.strings variant group.
    let variantGroupKey = proj.findPBXVariantGroupKey({ name: 'InfoPlist.strings' });
    if (!variantGroupKey) {
        const vg = proj.addLocalizationVariantGroup('InfoPlist.strings');
        variantGroupKey = vg.fileRef;
    }

    // Add each resource path to the variant group if not already present.
    const existingPaths = collectExistingFileRefPaths(proj);
    let added = 0;
    for (const resourcePath of resourcePaths) {
        if (existingPaths.has(resourcePath)) continue;
        proj.addResourceFile(resourcePath, { variantGroup: true }, variantGroupKey);
        added++;
    }

    fs.writeFileSync(pbxprojPath, proj.writeSync());
    log(`iOS: registered ${added} new locale(s) (${resourcePaths.length} total) in Xcode project.`);

    purgeCordovaIosProjectCache(projectRoot);
}

function collectExistingFileRefPaths(proj) {
    const paths = new Set();
    const refs = proj.hash.project.objects.PBXFileReference || {};
    for (const key of Object.keys(refs)) {
        if (key.endsWith('_comment')) continue;
        const ref = refs[key];
        const refPath = (ref && ref.path || '').replace(/^"|"$/g, '');
        if (refPath) paths.add(refPath);
    }
    return paths;
}

// Cordova-ios caches the parsed pbxproj in memory. Operations that come after
// our hook (e.g. ProvisioningProfile signing modification) write that cached
// copy back to disk, overwriting our changes. Purging the cache forces them
// to re-read the (now-updated) file from disk.
function purgeCordovaIosProjectCache(projectRoot) {
    const platformPath = path.join(projectRoot, 'platforms', 'ios');
    const candidates = [
        path.join(platformPath, 'cordova', 'lib', 'projectFile.js'),
        path.join(projectRoot, 'node_modules', 'cordova-ios', 'lib', 'projectFile.js'),
    ];

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        try {
            delete require.cache[require.resolve(candidate)];
            const api = require(candidate);
            if (typeof api.purgeProjectFileCache === 'function') {
                api.purgeProjectFileCache(platformPath);
                log(`iOS: purged cordova-ios project file cache via ${path.relative(projectRoot, candidate)}.`);
                return;
            }
        } catch (e) {
            warn(`iOS: could not purge cordova-ios cache via ${candidate}: ${e.message}`);
        }
    }
    warn('iOS: cordova-ios projectFile.js not found, could not purge pbxproj cache. Subsequent cordova-ios operations may overwrite our edits.');
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

function writeAndroid(projectRoot, entries, appDefaultName) {
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
        writeAndroidStrings(path.join(resDir, `values-${androidLocale}`), appName);
        log(`Android -> values-${androidLocale}/strings.xml = "${appName}"`);
        wrote++;
    }
    log(`Android: wrote ${wrote} locale file(s).`);

    // The default (unqualified) name must overwrite app_name where Cordova already
    // defines it — values/cdv_strings.xml on cordova-android 14+, values/strings.xml
    // on older. We rewrite that file in place; writing our own values/strings.xml
    // would define the same names twice in one folder, which fails Gradle's
    // mergeResources with "Duplicate resources".
    if (appDefaultName) {
        applyAndroidDefaultName(resDir, appDefaultName);
    }
}

// Locale folders (values-<locale>/) start empty, so we create the file and add keys.
function writeAndroidStrings(valuesDir, appName) {
    fs.mkdirSync(valuesDir, { recursive: true });

    const stringsPath = path.join(valuesDir, 'strings.xml');
    let xml = fs.existsSync(stringsPath)
        ? fs.readFileSync(stringsPath, 'utf8')
        : `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n`;

    for (const key of ANDROID_STRING_KEYS) {
        xml = upsertAndroidString(xml, key, appName);
    }

    fs.writeFileSync(stringsPath, xml, 'utf8');
}

function applyAndroidDefaultName(resDir, appName) {
    const valuesDir = path.join(resDir, 'values');
    const target = findAndroidStringsFile(valuesDir, 'app_name');
    if (!target) {
        warn('Android: no values/*.xml defines app_name; cannot set default name.');
        return;
    }

    let xml = fs.readFileSync(target, 'utf8');
    for (const key of ANDROID_STRING_KEYS) {
        xml = replaceAndroidString(xml, key, appName);
    }
    fs.writeFileSync(target, xml, 'utf8');
    log(`Android -> ${path.relative(resDir, target)} (default) = "${appName}"`);
}

// Locate the values/*.xml that already declares the given string, so we overwrite
// it in place instead of introducing a duplicate definition.
function findAndroidStringsFile(valuesDir, key) {
    let files;
    try {
        files = fs.readdirSync(valuesDir).filter(f => f.endsWith('.xml'));
    } catch {
        return null;
    }
    const pattern = new RegExp(`<string\\b[^>]*\\bname="${key}"`);
    for (const f of files) {
        const p = path.join(valuesDir, f);
        try {
            if (pattern.test(fs.readFileSync(p, 'utf8'))) return p;
        } catch { /* skip unreadable */ }
    }
    return null;
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

// Replace an existing <string name="key">…</string> value in place, keeping the
// opening tag's attributes. Unlike upsertAndroidString it never appends: adding a
// key that's missing here could duplicate one defined in another values/ file.
function replaceAndroidString(xml, key, value) {
    const escaped = escapeXmlValue(value);
    const pattern = new RegExp(`(<string\\b[^>]*\\bname="${key}"[^>]*>)[\\s\\S]*?(</string>)`);
    return pattern.test(xml) ? xml.replace(pattern, `$1${escaped}$2`) : xml;
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

// Plist <string> text needs only markup escaping — and must NOT backslash-escape
// apostrophes the way escapeXmlValue does (that's an Android-only rule).
function escapePlistValue(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
