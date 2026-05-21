# Contributing

Thanks for considering a contribution. This is a small, focused plugin — the bar is "does it make the iOS or Android home-screen label localization more correct or more robust on Cordova", and not much else. PRs that grow the scope (Localizable.strings, AppShortcuts, Settings.bundle, etc.) will likely be redirected to [`cordova-plugin-localization-strings`](https://github.com/kelvinhokk/cordova-plugin-localization-strings), which already handles all of that.

## Reporting bugs

Open an issue at https://github.com/promonteiro89/cordova-plugin-localized-app-name/issues with:

1. **Environment**: Cordova version, cordova-android / cordova-ios version, MABS version if OutSystems, host OS (macOS / Linux / Windows).
2. **Your `<locale>.json` files** — anonymized contents are fine, but keep the structure intact.
3. **The `[localized-app-name]` lines from your build log** — at minimum, everything between hook start and end. If you're on OutSystems and can only get logs on failure, attach the full build log when something does fail; otherwise paste what you have.
4. **What you expected to see** in the resulting APK/IPA vs **what's actually there**. Bonus points for an `unzip -l` listing of the relevant section of the bundle.

The hook is small (≈300 lines, one file) — the more concrete the bug report, the faster the fix.

## Suggesting features

Open an issue first to discuss. The scope is intentionally narrow: **home-screen app name localization, nothing else**. If the feature isn't that, expect a "won't fix, here's where to look instead" response.

## Development setup

You need:

- Node.js ≥ 18
- Cordova CLI (`npm install -g cordova` or use via `npx`)
- For iOS: macOS, full Xcode (not just Command Line Tools), and CocoaPods (`brew install cocoapods`)
- For Android: Android SDK + JDK 17

The plugin itself has no dependencies to install — `hooks/after_prepare.js` only uses Node built-ins plus the `xcode` package that ships with cordova-ios.

## Running locally against a test Cordova project

There are no automated tests yet — the plugin is a build-time hook that's hard to unit test in isolation. The workflow is:

```bash
# 1. Make your changes to hooks/after_prepare.js
# 2. Set up a throwaway Cordova project (or use an existing one)
cordova create /tmp/plugin-test com.example.test TestApp
cd /tmp/plugin-test
cordova platform add ios
cordova platform add android

# 3. Drop test JSONs
mkdir -p translations/app
cat > translations/app/en.json <<'EOF'
{ "config_ios": { "CFBundleDisplayName": "Test" }, "config_android": { "app_name": "Test" } }
EOF
cat > translations/app/pt.json <<'EOF'
{ "config_ios": { "CFBundleDisplayName": "Teste" }, "config_android": { "app_name": "Teste" } }
EOF

# 4. Install the plugin from your local checkout (use the path, not the git URL)
cordova plugin add /path/to/your/local/cordova-plugin-localized-app-name

# 5. Prepare and inspect
cordova prepare
# Hook output appears here. Then:
find platforms/ios -name "InfoPlist.strings"
find platforms/android -name "strings.xml" -path "*/values-*"

# 6. Optional: build and run on simulator/emulator
cordova run ios --emulator
cordova run android --emulator
```

## What "verified" means

Before merging a PR that touches the hook, please verify against **at least one of**:

- **Cordova iOS Simulator end-to-end**: build for `iphonesimulator`, install in the simulator, switch system language, confirm the home-screen icon label changes. This is the only test that fully exercises the path including xcodebuild bundling and iOS runtime resolution.
- **Cordova Android emulator end-to-end**: build, install, switch system language, confirm the icon label changes.
- **OutSystems MABS build**: trigger a build of a mobile app that depends on a plugin module pointing at your fork/branch, inspect the resulting APK/IPA for the localized `values-<locale>/strings.xml` or `<locale>.lproj/InfoPlist.strings`.

If your PR only changes documentation or logging, a quick `npx cordova prepare` against a test project to confirm the hook still runs without crashing is enough.

## Code style

- Plain Node.js, no transpilation.
- No external runtime dependencies. The `xcode` package is loaded via `require('xcode')` which resolves through the consumer project's cordova-ios install — don't add it as a direct dependency.
- Match the existing style in `hooks/after_prepare.js`: 4-space indent, single quotes, descriptive function names, sparse comments that explain the **why** (especially for non-obvious things like the cordova-ios cache purge).
- One log line per major step. Avoid per-iteration verbosity unless it's diagnostic-only.
- Wrap risky operations in try/catch and log via `warn(...)` or `err(...)` — never let the hook crash the user's build over a fixable warning.

## Release process

For maintainers cutting a new version:

1. Bump `version` in `plugin.xml` and `package.json` (both fields, plus the `cordovaDependencies` key).
2. Commit with a message describing what changed.
3. Tag: `git tag -a 1.0.X -m "1.0.X"` then `git push && git push origin 1.0.X`.
4. Create a GitHub release with `gh release create 1.0.X --title "..." --notes "..."`. Release notes should explain root cause for any fix (the iOS pbxproj-cache bug write-up in 1.0.5 is a good template).
5. Update the README install URLs to pin the new version.
6. If the change affects OutSystems consumers, note in the release that they should also bump their **Plugin Module's `metadata.version`** so consumer apps re-snapshot.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
