# Android WebView remote debugging (Capacitor)

Khatario ships as a **Capacitor thin shell**: the UI runs in the **in-app Android WebView** (`BridgeActivity` / Capacitor bridge), loading `server.url` (e.g. `https://staging.khatario.com/login`). It is **not** a Trusted Web Activity, **not** Chrome Custom Tabs, and **not** an external browser launch (no `@capacitor/browser` usage).

## Why `adb devices` works but `chrome://inspect` shows nothing / stale targets

These are **independent** systems:

| Layer | What it proves |
|---|---|
| `adb devices` → `device` | USB debugging authorized; shell access works |
| `chrome://inspect` | Requires **WebView remote debugging enabled in the app process** and an **active WebView** with a debug socket |

Common causes when ADB is fine but inspect fails:

1. **`WebView.setWebContentsDebuggingEnabled(false)`** — previously `capacitor.config.ts` only enabled debugging when `NODE_ENV !== 'production'`. Many builds/syncs run with `NODE_ENV=production`, so Capacitor synced `webContentsDebuggingEnabled: false` into `android/app/src/main/assets/capacitor.config.json`.
2. **No native call** — `MainActivity` did not call `WebView.setWebContentsDebuggingEnabled(true)`; Capacitor only applies the config flag when true at bridge init.
3. **Release APK** — `installRelease` / Play builds: `android:debuggable=false` and `ENABLE_WEBVIEW_DEBUG=false` (by design).
4. **Looking for the wrong target** — Inspect lists **`WebView in com.khatario.app (https://staging.khatario.com/...)`**, not a tab titled "Khatario". Stale entries persist until you kill the app and refresh `chrome://inspect`.
5. **App in background / WebView not loaded** — Splash or process death leaves no live socket. Open the app and wait for `/login` to load.
6. **Samsung / WebView provider** — Outdated **Android System WebView** or Chrome/WebView mismatch. Check: Settings → Apps → Android System WebView (update via Play Store).
7. **Multiprocess WebView** — On Android 9+, WebView may run in `:webview` process; it still appears under the app package in `chrome://inspect` when debugging is enabled.
8. **Desktop Chrome** — Use current Chrome, enable **Discover USB devices** on `chrome://inspect`. Samsung DeX / wrong USB mode can block forwarding until USB debugging is stable.

## What we enable (code)

| Location | Behavior |
|---|---|
| `KhatarioApplication` | Calls `WebView.setWebContentsDebuggingEnabled(true)` before any WebView exists (when `BuildConfig.ENABLE_WEBVIEW_DEBUG`) |
| `MainActivity` | Re-affirms debugging before `super.onCreate()`; logs URL/progress via tag `KhatarioWebView` |
| `android/app/build.gradle` | `debug`: `ENABLE_WEBVIEW_DEBUG=true`, `debuggable true`; `release`: both false |
| `capacitor.config.ts` | `webContentsDebuggingEnabled` true for staging URL, `CAP_WEBVIEW_DEBUG=true`, or non-production NODE_ENV |
| `scripts/cap-android-build.mjs` | Sets `CAP_WEBVIEW_DEBUG=true` for **staging** installs |

## Install a debuggable build

```bash
npm run cap:android:staging:install
```

This runs `gradlew installDebug` — **not** release.

Verify synced config after sync:

```bash
# Should contain "webContentsDebuggingEnabled": true for staging
type android\app\src\main\assets\capacitor.config.json
```

## Runtime verification (on your PC)

```bash
node scripts/verify-android-webview-debug.mjs
```

Manual checks:

```bash
adb devices -l
adb shell dumpsys webviewupdate
adb shell pidof com.khatario.app
adb shell cat /proc/net/unix | findstr /i webview
adb logcat -s KhatarioWebView
```

Expect `webview_devtools_remote_*` in `/proc/net/unix` when the app is foreground and debugging is on.

## In-app probe page

On the phone (inside the APK WebView), open:

`https://staging.khatario.com/debug/webview`

You should see `platform: android`, `isNative: true`, and current `href`. In attached DevTools console: `window.__KHATARIO_WEBVIEW_DEBUG__`.

## Attach DevTools

1. Phone: USB debugging on, app open on `/debug/webview` or `/login`
2. Desktop Chrome → `chrome://inspect/#devices`
3. Enable **Discover USB devices**
4. Click **inspect** on `com.khatario.app` WebView row
5. If stale: force-stop app, `adb kill-server && adb start-server`, refresh inspect

`localhost:9222` is used when port-forwarding is set up; for USB, `chrome://inspect` is the primary path for WebView.

## Release builds

Play Store / `installRelease`: remote debugging is **off** (`ENABLE_WEBVIEW_DEBUG=false`). Use **debug/staging APK** for WebView inspection.
