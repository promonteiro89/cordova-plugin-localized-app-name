#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[localized-app-name]';

const ANDROID_STRING_KEYS = ['app_name', 'launcher_name', 'activity_name'];

const LOCALE_FILENAME_PATTERN = /^[a-zA-Z]{2,3}([-_][a-zA-Z0-9]+)*\.json$/;

module.exports = function (context) {
    const projectRoot = context.opts.projectRoot;
    const discovery = findTranslationsDir(projectRoot);

    if (!discovery) {
        console.log(`${LOG_PREFIX} No locale JSON files found in any known location, skipping.`);
        console.log(`${LOG_PREFIX} Searched: translations/app/, www/translations/app/, www/`);
        return;
    }

    console.log(`${LOG_PREFIX} Reading locale files from ${path.relative(projectRoot, discovery.dir) || '.'}`);

    const platforms = context.opts.platforms || [];
    const entries = discovery.files
        .map(file => {
            const locale = path.basename(file, path.extname(file));
            try {
                const data = JSON.parse(fs.readFileSync(path.join(discovery.dir, file), 'utf8'));
                return { locale, data };
            } catch (e) {
                console.error(`${LOG_PREFIX} Failed to parse ${file}: ${e.message}`);
                return null;
            }
        })
        .filter(Boolean);

    if (platforms.includes('ios')) writeIos(projectRoot, entries);
    if (platforms.includes('android')) writeAndroid(projectRoot, entries);
};

function findTranslationsDir(projectRoot) {
    const candidates = [
        path.join(projectRoot, 'translations', 'app'),
        path.join(projectRoot, 'www', 'translations', 'app'),
        path.join(projectRoot, 'www'),
    ];

    for (const dir of candidates) {
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir).filter(f => isLocaleFile(dir, f));
        if (files.length > 0) return { dir, files };
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
    if (!fs.existsSync(iosDir)) return;

    const appFolder = findIosAppFolder(iosDir);
    if (!appFolder) {
        console.warn(`${LOG_PREFIX} Could not locate iOS app folder, skipping iOS.`);
        return;
    }

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
        console.log(`${LOG_PREFIX} iOS  -> ${locale}.lproj/InfoPlist.strings`);
    }
}

function writeAndroid(projectRoot, entries) {
    const resDir = path.join(projectRoot, 'platforms', 'android', 'app', 'src', 'main', 'res');
    if (!fs.existsSync(resDir)) return;

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
        console.log(`${LOG_PREFIX} Android -> values-${androidLocale}/strings.xml`);
    }
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
        const plistMatch = fs.readdirSync(candidate).some(f => f.endsWith('-Info.plist'));
        if (plistMatch) return candidate;
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
