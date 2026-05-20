#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[localized-app-name]';

module.exports = function (context) {
    const projectRoot = context.opts.projectRoot;
    const translationsDir = path.join(projectRoot, 'translations', 'app');

    if (!fs.existsSync(translationsDir)) {
        console.log(`${LOG_PREFIX} No translations/app/ directory found, skipping.`);
        return;
    }

    const files = fs.readdirSync(translationsDir).filter(f => f.toLowerCase().endsWith('.json'));
    if (files.length === 0) {
        console.log(`${LOG_PREFIX} No .json files in translations/app/, skipping.`);
        return;
    }

    const platforms = context.opts.platforms || [];
    const entries = files.map(file => {
        const locale = path.basename(file, path.extname(file));
        try {
            const data = JSON.parse(fs.readFileSync(path.join(translationsDir, file), 'utf8'));
            return { locale, data };
        } catch (e) {
            console.error(`${LOG_PREFIX} Failed to parse ${file}: ${e.message}`);
            return null;
        }
    }).filter(Boolean);

    if (platforms.includes('ios')) {
        writeIos(projectRoot, entries);
    }
    if (platforms.includes('android')) {
        writeAndroid(projectRoot, entries);
    }
};

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
        const xmlValue = escapeXmlValue(appName);
        let output;

        if (fs.existsSync(stringsPath)) {
            const existing = fs.readFileSync(stringsPath, 'utf8');
            if (/<string\s+name="app_name"\s*>[\s\S]*?<\/string>/.test(existing)) {
                output = existing.replace(
                    /<string\s+name="app_name"\s*>[\s\S]*?<\/string>/,
                    `<string name="app_name">${xmlValue}</string>`
                );
            } else {
                output = existing.replace(
                    /<\/resources>/,
                    `    <string name="app_name">${xmlValue}</string>\n</resources>`
                );
            }
        } else {
            output =
                `<?xml version="1.0" encoding="utf-8"?>\n` +
                `<resources>\n` +
                `    <string name="app_name">${xmlValue}</string>\n` +
                `</resources>\n`;
        }

        fs.writeFileSync(stringsPath, output, 'utf8');
        console.log(`${LOG_PREFIX} Android -> values-${androidLocale}/strings.xml`);
    }
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
