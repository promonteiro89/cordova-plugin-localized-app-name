# cordova-plugin-localized-app-name

A focused Cordova plugin that localizes your app's **home-screen display name** on iOS and Android based on the device language.

- English device → "Continente Card"
- Portuguese device → "Cartão Continente"
- Spanish device → "Tarjeta Continente"
- ...and any other language you define

Built for OutSystems 11 Cordova apps (works in any Cordova project).

## How it works

At build time, the plugin reads one small JSON file per language from `translations/app/` and generates the native localization files:

- **iOS** → `<locale>.lproj/InfoPlist.strings` with `CFBundleDisplayName`
- **Android** → `values-<locale>/strings.xml` with `app_name`

The OS picks the right one based on the device language. Locales you don't define fall back to your default app name automatically — you only need to ship the languages you actually want to support.

## Install

### Standard Cordova

```bash
cordova plugin add https://github.com/promonteiro89/cordova-plugin-localized-app-name
```

### OutSystems 11

In your mobile app's **Extensibility Configurations**:

```json
{
  "preferences": {
    "ios": [
      { "name": "CFBundleAllowMixedLocalizations", "value": "true" }
    ]
  },
  "plugin": [
    { "url": "https://github.com/promonteiro89/cordova-plugin-localized-app-name" }
  ],
  "resource": [
    { "file": "en.json", "target": "translations/app/en.json" },
    { "file": "pt.json", "target": "translations/app/pt.json" }
  ]
}
```

The `CFBundleAllowMixedLocalizations` preference is **required** on iOS — without it, iOS silently ignores the localized display name.

Upload your `en.json`, `pt.json`, etc. as Module Resources in Service Studio (Deploy Action = *Deploy to Target Directory*).

## JSON format

One file per language, named `<locale>.json`:

```json
{
  "config_ios": {
    "CFBundleDisplayName": "Cartão Continente"
  },
  "config_android": {
    "app_name": "Cartão Continente"
  }
}
```

Sample files are in [`examples/translations/app/`](examples/translations/app).

### Locale codes

- iOS uses the locale code from the filename as-is (`en`, `pt`, `pt-PT`, `zh-Hans`).
- Android converts region variants automatically: `pt-PT` → `values-pt-rPT`.

Use simple two-letter codes (`en`, `pt`, `es`) unless you specifically need regional variants.

## Testing

After building and installing on a device:

1. Change the device's system language.
2. Reboot or reinstall the app — the home-screen label only refreshes on install or language change.
3. The icon label should now match the new language.

## Limitations

- **Locale fallback**: if you ship `pt.json` but the device is set to `pt-BR`, iOS handles fallback gracefully; Android may need an explicit `pt-BR.json`. Test the locales your users actually have.
- **iOS Chinese variants** (`zh-Hans`, `zh-Hant`) work on iOS but don't map cleanly to Android's older locale system. Use `zh-CN.json` / `zh-TW.json` for Android compatibility.
- The native files are regenerated on every Cordova `prepare`, so the plugin must run on every build. That's why it's an `after_prepare` hook — don't try to commit the generated files.

## Why a plugin and not just resource files?

In Cordova, the `platforms/ios/` and `platforms/android/` folders are wiped and regenerated on every build. You can't just upload `pt.lproj/InfoPlist.strings` as a static resource — it'd get deleted. The plugin runs a hook **after** Cordova regenerates the platform folders, so the localization files always land in the right place. Capacitor users don't need this — they can edit native projects directly.

## License

MIT
