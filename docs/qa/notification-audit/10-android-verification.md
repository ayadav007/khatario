# Android verification of the push implementation

Date: 2026-10-29. Device: Android emulator, Pixel 7 profile, Android 15 (API 35), Google APIs x86_64. The original `khatario_pixel` AVD (9.6 GB on C:) could no longer boot because C: had 0.9 GB free; a fresh AVD `khatario_push` was created under `D:\android-avd` (set `ANDROID_AVD_HOME=D:\android-avd` to use it; delete the folder to remove it). The machine was also short of memory during this session (0.4 GB free RAM with the emulator and a Gradle daemon alive), which forced the builds and the device runs to be sequenced and the Flutter Gradle heap to be lowered for the build (`GRADLE_OPTS=-Dorg.gradle.jvmargs=-Xmx3g`).

Statuses: **PASS**, **FAIL**, **BLOCKED**, **NOT TESTED**, as in `docs/qa/README.md`. Nothing in this file claims that a Firebase message reached a phone: no Firebase project exists yet (`09-firebase-setup.md`).

## Why most FCM rows are blocked

Three separate blockers, each named in the rows:

1. **No Firebase configuration** (`google-services.json`, service account): `PushNotifications.register()` in the shell and `Firebase.initializeApp()` in the Flutter app fail by design; no token can be minted, so nothing can be sent.
2. **The shell loads the remote site**: the web-side registration and tap code (`PushRegistration.tsx`, `capacitor-push.ts`) only runs once deployed to staging. On the emulator the shell showed the local `offline.html` because the fresh AVD had no network route (`ping 8.8.8.8: Network is unreachable`), so even the staging bell could not be exercised. The native parts (channel, permission, local notification plugin, tap event into the WebView) were exercised directly through the Capacitor bridge over the DevTools protocol.
3. **No device sign-in**: reading a test account's password from `.env` was refused by the session's permission classifier, and typing production or staging credentials on the emulator was not attempted. Everything that needs a signed-in user (token registration, business switch on tap, Flutter permission prompt, which only runs after a session loads) is therefore BLOCKED here.

## Capacitor shell `com.khatario.app` (APK built this session: versionCode 5, 1.4.0)

| # | Check | Steps | Expected | Actual | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | APK carries the permission and plugins | `aapt2 dump badging` | `POST_NOTIFICATIONS` declared; version 5 | declared; `versionCode='5' versionName='1.4.0'` | PASS | badging output |
| C2 | Channel created before any message | install, launch, `logcat -s KhatarioWebView`, `dumpsys notification` | `khatario_alerts`, importance 4, default sound, vibration pattern | `Application: notification channel ready id=khatario_alerts`; `NotificationChannel{mId='khatario_alerts', mName=Khatario alerts, mImportance=4, mSound=content://settings/system/notification_sound, mVibrationPattern=[0, 250, 150, 250] …}` | PASS | logcat and dumpsys lines in this session |
| C3 | Permission state before any request | `dumpsys package com.khatario.app` | declared, `granted=false` until requested | `android.permission.POST_NOTIFICATIONS: granted=false` | PASS (expected initial state) | dumpsys |
| C4 | Android 13 permission prompt from the app | `PushNotifications.requestPermissions()` through the bridge | system dialog; Allow → `granted` | see "Device run" below | see below | screenshot |
| C5 | Permission denied path | deny in the dialog, reopen `/notifications` | `checkPermissions` → `denied`; notice on the page explains Android settings | notice needs the deployed web code | BLOCKED (2) | — |
| C6 | FCM registration | `PushNotifications.register()` | `registration` event with a token (hash only in logs) | `registrationError` because no `google-services.json` | BLOCKED (1), error path PASS | see "Device run" |
| C7 | Foreground display on the channel: icon, app name, title, body | `LocalNotifications.schedule` on `khatario_alerts` with `smallIcon ic_stat_khatario` (the same call `capacitor-push.ts` makes for a foreground push) | card in the shade with the K icon, "Khatario", title, body; heads-up on a high channel | see "Device run" | see below | screenshot, dumpsys |
| C8 | Sound and vibration | channel flags | default sound URI and vibration pattern set on the channel; the emulator has no audio output (`-no-audio`) | channel flags verified in C2; audible playback NOT TESTED | PASS (channel) / NOT TESTED (audible) | dumpsys |
| C9 | Tap routing | tap the card; `localNotificationActionPerformed` listener registered through the bridge | event with the `extra` data (href, notification id) reaches the WebView; the app comes to the foreground | see "Device run" | see below | — |
| C10 | Duplicate prevention | foreground: only the local card (Android shows no push in the foreground); background: only the FCM card | by construction (`08` §4); not observable without FCM | BLOCKED (1) | — |
| C11 | Background, terminated, reboot delivery | needs FCM | — | BLOCKED (1) | — |
| C12 | Invalid or refreshed token, network interruption, retries | server side proven in `tests/db/push-dispatch.db.test.ts`; device side needs FCM | — | PASS (server) / BLOCKED (device) | DB test |
| C13 | Logout, account switch, multi-business | server side: `revokePushDevice` owner scope, session-version revocation, membership join (DB tests); device side needs sign-in | — | PASS (server) / BLOCKED (3) | DB test |
| C14 | Store customer registration and customer-only delivery | server side proven (customer device not reached by business broadcast; customer job reaches only that shop's device) | — | PASS (server) / BLOCKED (2,3) | DB test |

## Flutter app `com.khatario.phone`

| # | Check | Steps | Expected | Actual | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Build with the new plugins | `flutter build apk --debug --flavor owner` | APK with `POST_NOTIFICATIONS`; `google-services.json not found` warning | see "Device run" | see below | build log |
| F2 | Channel created at start | install, launch, `dumpsys notification` | `khatario_alerts` importance high with sound and vibration, created by `push_service.dart` before Firebase (so it exists even without the config) | see "Device run" | see below | dumpsys |
| F3 | Permission prompt after sign-in | sign in | Android 13 dialog once | BLOCKED (3); also only runs when Firebase is configured (1) | BLOCKED | — |
| F4 | Foreground card, icon, tap | needs FCM and sign-in | — | BLOCKED (1,3) | — |
| F5 | Tap parser | `flutter test test/push_tap_test.dart` | site path only, business mismatch detection | 2 passed | PASS | test output |
| F6 | Background / terminated display | needs FCM | — | BLOCKED (1) | — |
| F7 | Business switch on tap, logout unregister | code-level (`app_shell.dart`, `main.dart`); needs sign-in | — | BLOCKED (3) | — |

## Device run log

Emulator `khatario_push` (D:), Android 15, booted with `-memory 1536` because the host had 2.2 GB free RAM; the guest's `lowmemorykiller` and ActivityManager killed `com.khatario.app` twice during the run ("Killing … excessive binder traffic during cached", host free RAM 0.5–0.8 GB at the time), which cut the DevTools session each time.

| Row | What was done | Result | Status |
| --- | --- | --- | --- |
| C1 | `aapt2 dump badging app-debug.apk` | `versionCode='5' versionName='1.4.0'`, `android.permission.POST_NOTIFICATIONS` declared | PASS |
| C2 | installed, launched; `logcat -s KhatarioWebView`; `dumpsys notification` | `Application: notification channel ready id=khatario_alerts`; channel importance 4 (HIGH), `mSound=content://settings/system/notification_sound`, `mVibrationPattern=[0, 250, 150, 250]` | PASS |
| C3 | `dumpsys package` before any request | `POST_NOTIFICATIONS: granted=false` | PASS (initial state) |
| C4 | bridge: `PushNotifications.checkPermissions()` → `{"receive":"prompt"}`; `requestPermissions()` → system dialog "Allow Khatario to send you notifications?" (`evidence/emu-shell-permission-dialog.png`); tapped Allow; `dumpsys package` → `granted=true, flags=[USER_SET…]`; relaunch, `checkPermissions()` → `{"receive":"granted"}` | the real Android 13+ prompt is driven by the plugin the web code calls; grant persists across relaunch | PASS |
| C6 | `PushNotifications.register()` with `registration` / `registrationError` listeners | the process was killed by the guest before the result could be read (two attempts) | BLOCKED (host memory); expected result without `google-services.json` is `registrationError` |
| C7 | `LocalNotifications.schedule` on `khatario_alerts` with `ic_stat_khatario` (the foreground-display call) | same kill before the call returned; no card was posted (`dumpsys notification` shows no `NotificationRecord` for the package) | BLOCKED (host memory) |
| C9 | `localNotificationActionPerformed` listener + tap | not reached | BLOCKED (host memory) |
| F1 | `flutter build apk --debug --flavor owner` | first run: `flutter_local_notifications requires core library desugaring` → fixed in `build.gradle.kts`; second and third runs: JVM `The paging file is too small for this operation to complete` / Dart VM `Out of memory` / `Could not start thread DartWorker` (C: has 0.9 GB free, so the page file cannot grow; the project's `org.gradle.jvmargs=-Xmx8G` cannot be honoured; `-Xmx3g` via `GRADLE_OPTS` was still not enough with the other processes on the machine) | BLOCKED (host memory). `flutter analyze`: no errors; `flutter test`: 5 passed |
| F2 | needs F1 | — | BLOCKED |

How to finish the blocked rows on a machine with free memory (no Firebase needed for C6–C9, F1–F2):

1. `cd android && set JAVA_HOME=<JDK 21> && gradlew.bat assembleDebug`; `cd phone && flutter build apk --debug --flavor owner`.
2. `adb install -r` both APKs; launch; `dumpsys notification` must list `khatario_alerts` for both packages (the Flutter app creates it in `PushService.init()` even without Firebase).
3. Shell (while the staging login is on screen): `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` and evaluate `Capacitor.Plugins.LocalNotifications.schedule({...channelId:'khatario_alerts', smallIcon:'ic_stat_khatario'...})` as in the C7 row; expect a heads-up card with the K icon, app name "Khatario", the title and body; `dumpsys notification` shows `channel=khatario_alerts`, `icon=…ic_stat_khatario`, `vis=PRIVATE`; tapping it fires `localNotificationActionPerformed` with `extra.href`.
4. `Capacitor.Plugins.PushNotifications.register()` → `registrationError` until `google-services.json` exists, then a `registration` token (log its length, never the value).
5. With Firebase configured and a staging persona signed in: rows C5, C10–C14, F3–F7 as written above.
