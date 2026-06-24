# cordova-plugin-localized-app-name

[![Release](https://img.shields.io/github/v/release/promonteiro89/cordova-plugin-localized-app-name?sort=semver&color=blue)](https://github.com/promonteiro89/cordova-plugin-localized-app-name/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-iOS%20%7C%20Android-lightgrey)](#)
[![Cordova](https://img.shields.io/badge/cordova-%E2%89%A59.0.0-brightgreen)](https://cordova.apache.org/)
[![OutSystems 11](https://img.shields.io/badge/OutSystems-11-d92b1d)](https://www.outsystems.com/)

A focused Cordova plugin that localizes your app's **home-screen display name** on iOS and Android based on the device language.

- English device → "Weather"
- Portuguese device → "Tempo"
- Spanish device → "Clima"
- French device → "Météo"
- German device → "Wetter"
- ...and any other language you define

Built for OutSystems 11 Cordova apps. Works in any Cordova project.

## How it works

At build time, the plugin reads one small JSON file per language and generates the native localization files:

- **iOS** → `<locale>.lproj/InfoPlist.strings` with `CFBundleDisplayName` and `CFBundleName`, registered in `App.xcodeproj/project.pbxproj` (with cordova-ios's pbxproj cache purged so the registration survives signing setup).
- **Android** → `values-<locale>/strings.xml` with `app_name`, `launcher_name`, and `activity_name` (writes all three so the localized label applies regardless of which key Cordova's manifest references).

The OS picks the right one based on the device language. Locales you don't define fall back to your default app name automatically — your project's configured app name, or an explicit [`AppDefaultName`](#default-app-name-appdefaultname) if you set one. You only ship the languages you actually want to support.

### Where the plugin looks for JSON files

It tries these locations in order and uses the first one that contains valid locale files:

1. `<projectRoot>/translations/app/` — standard Cordova location
2. `<projectRoot>/www/translations/app/` — if you keep them under the web root
3. `<projectRoot>/www/` — OutSystems MABS (resource targets are flattened to `www/`)

A "valid locale file" is a `.json` whose filename looks like a locale code (`en.json`, `pt-PT.json`, `zh-Hans.json`) **and** whose contents have a `config_ios` or `config_android` key. Other JSONs in `www/` are ignored.

## JSON format

One file per language, named `<locale>.json`:

```json
{
  "config_ios": {
    "CFBundleDisplayName": "Tempo"
  },
  "config_android": {
    "app_name": "Tempo"
  }
}
```

Sample files are in [`examples/translations/app/`](examples/translations/app).

### Locale codes

- iOS uses the locale code from the filename as-is (`en`, `pt`, `pt-PT`, `zh-Hans`).
- Android converts region variants automatically: `pt-PT` → `values-pt-rPT`.

Use simple two-letter codes (`en`, `pt`, `es`) unless you specifically need regional variants.

## Default app name (`AppDefaultName`)

Your locale files only cover the languages you ship. When the device language matches none of them, the OS uses the app's **default** name — normally your project's app name (`<name>` in `config.xml`, or the OutSystems app/module name).

Set the optional global preference `AppDefaultName` to override that fallback explicitly. One value covers **both** platforms:

- **iOS** → `CFBundleDisplayName` and `CFBundleName` in the app's `Info.plist`.
- **Android** → `app_name`, `launcher_name`, and `activity_name` in the default (unqualified) `values/strings.xml`.

It's read from `config.xml` at build time, so it works with or without locale files — if you only want to set the home-screen name and don't need per-language localization, set `AppDefaultName` alone and ship no JSON files.

**OutSystems 11** — add it to the **global** preferences in your mobile app's Extensibility Configurations:

```json
{
  "preferences": {
    "global": [
      { "name": "AppDefaultName", "value": "Weather" }
    ]
  }
}
```

**Standard Cordova** — add a global `<preference>` to `config.xml`:

```xml
<preference name="AppDefaultName" value="Weather" />
```

> It must be a **global** preference — a `<preference>` placed inside a `<platform>` block is ignored on purpose, since the one value is meant to apply to both platforms.

## Install — OutSystems 11

OutSystems 11 uses a two-module pattern: a thin **Plugin Module** that points at this repo, and your **Mobile App** that depends on that Plugin Module.

### 1. Create the Plugin Module

Create a new Plugin module (or reuse an existing one) with this in its Extensibility Configurations:

```json
{
    "plugin": {
        "url": "https://github.com/promonteiro89/cordova-plugin-localized-app-name.git#1.1.0"
    },
    "metadata": {
        "mabs-min": "10.0.0",
        "name": "Localized App Name Plugin",
        "version": "1.1.0"
    }
}
```

**1-Click Publish** the Plugin Module.

> **Tip:** Whenever you upgrade to a newer plugin version, bump `metadata.version` to a fresh value (e.g. `1.1.1`) and republish — otherwise OutSystems may serve consumer apps a cached snapshot of the Plugin Module and the URL change won't take effect.

### 2. Upload the locale JSONs as Module Resources

In Service Studio, in your **mobile app** module, add each locale file under **Resources** with **Deploy Action = Deploy to Target Directory**:

- `en.json`
- `pt.json`
- `es.json`
- … one per language you want to support

MABS flattens resource targets to the `www/` root, which the plugin auto-detects.

### 3. Wire up the mobile app

In your mobile app's Extensibility Configurations, set the required iOS preference:

```json
{
  "preferences": {
    "ios": [
      { "name": "CFBundleAllowMixedLocalizations", "value": "true" }
    ]
  }
}
```

`CFBundleAllowMixedLocalizations` is **required** on iOS — without it, iOS silently ignores the localized display name.

Optionally, set a fallback name for unsupported languages by adding `AppDefaultName` to `preferences.global` — see [Default app name](#default-app-name-appdefaultname).

Then in **Manage Dependencies**, add the Plugin Module from step 1 and tick its entry points.

### 4. Build

1-Click Publish the mobile app, then trigger a new MABS build.

## Install — Standard Cordova

```bash
cordova plugin add https://github.com/promonteiro89/cordova-plugin-localized-app-name.git#1.1.0
```

Put your JSON files at `translations/app/<locale>.json` in the project root.

For iOS, ensure `CFBundleAllowMixedLocalizations` is set to `true` in your `Info.plist`. In `config.xml`:

```xml
<platform name="ios">
    <config-file target="*-Info.plist" parent="CFBundleAllowMixedLocalizations">
        <true/>
    </config-file>
</platform>
```

Optionally, set a fallback name for unsupported languages with a global `<preference name="AppDefaultName" value="..." />` — see [Default app name](#default-app-name-appdefaultname).

## Testing

1. Build and install on the target device (or emulator/simulator).
2. Change the device's system language.
3. **Reboot or reinstall the app** — the home-screen label only refreshes on install or language change.
4. The icon label should now match the new language.

## Limitations

- **iOS device-only**: the home-screen label change is the OS-level `CFBundleDisplayName`; you'll only see it on a real device (or a simulator built with the iphonesimulator SDK). Verifying via an `.ipa` installed on a simulator doesn't work — IPAs are device-only builds.
- **Locale fallback**: if you ship `pt.json` but the device is set to `pt-BR`, iOS handles fallback gracefully; Android may need an explicit `pt-BR.json`. Test the locales your users actually have.
- **Chinese variants** (`zh-Hans`, `zh-Hant`) work on iOS but don't map cleanly to Android's older locale system. Use `zh-CN.json` / `zh-TW.json` for Android compatibility.
- **Generated files are not committed**. The `platforms/` folder is wiped and regenerated on every Cordova build; the hook regenerates the localization files each time. Don't try to commit them.

## Why a plugin and not just static resource files?

In Cordova, the `platforms/ios/` and `platforms/android/` folders are wiped and regenerated on every build. You can't just upload `pt.lproj/InfoPlist.strings` as a static resource — it'd get deleted on the next prepare. The plugin runs a hook **after** Cordova regenerates the platform folders, writes the locale resources to disk, registers them in the Xcode project (and on iOS, purges cordova-ios's in-memory pbxproj cache so the registration survives later signing operations).

Capacitor users don't need this — Capacitor's native projects are persistent and you edit them directly.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for bug reports, feature requests, dev setup, and the release process.

## Credits

iOS pbxproj handling and cordova-ios cache-purge approach inspired by [`kelvinhokk/cordova-plugin-localization-strings`](https://github.com/kelvinhokk/cordova-plugin-localization-strings). This plugin is a more focused, OutSystems-friendly take that only handles the home-screen app name (no `Localizable.strings`, no `Settings.bundle`, no `AppShortcuts.strings`).

## License

[MIT](LICENSE)
