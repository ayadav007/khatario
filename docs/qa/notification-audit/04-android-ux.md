# Notification audit, Phase 4: Android appearance, sound and user experience

Date: 2026-10-29. Device: Android emulator `khatario_pixel` (Pixel 7 profile, Android 15, API 35, Google APIs x86_64, no Play Store). APKs installed: `android/app/build/outputs/apk/debug/app-debug.apk` (Capacitor shell, built 2026-10-05, points at `https://staging.khatario.com`) and `phone/build/app/outputs/apk/owner/release/app-owner-release.apk` (Flutter owner app, built 2026-10-25, API base `https://staging.khatario.com`). Both apps were launched and reached their sign-in screens (`evidence/emu-capacitor-launch.png`: the staging web login inside the WebView; `evidence/emu-flutter-launch.png`: the native Flutter login). No staging account was signed in from the device, and no notification of any kind was sent.

## A. Notification appearance

Nothing can be inspected because nothing is ever posted. Verified facts that explain why:

| Check | Capacitor `com.khatario.app` | Flutter `com.khatario.phone` |
| --- | --- | --- |
| App name | `Khatario` (`application-label`, verified) | `Khatario` (verified) |
| Launcher icon | `mipmap-anydpi-v26/ic_launcher.xml` adaptive icon (verified) | `mipmap/ic_launcher` |
| Monochrome small icon for the status bar | **None.** `res/drawable*` holds `ic_launcher_background.xml`, `ic_launcher_foreground.xml`, splash images only. No `ic_stat_*`, no `ic_notification`. | **None.** |
| Notification channels after launch | **0** (`dumpsys notification --noredact` lists no `NotificationChannel{...}` under either package; 135 channels exist for other packages, so the dump works) | **0** |
| Code that posts a notification | None in `android/app/src/main/java` (3 classes: `KhatarioApplication`, `MainActivity`, `KhatarioBluetoothSppPlugin`) | None in `phone/android` or `phone/lib` |
| Web `Notification` API inside the WebView | `typeof Notification === 'undefined'`, no `PushManager` (verified over DevTools while the shell showed `https://staging.khatario.com/login`) | not applicable (Flutter widgets) |
| Title, body, truncation, grouping, large icon, duplicates | Not testable: no notification exists | Not testable |
| Duplicate from FCM auto-display plus local notification | Not possible today; a risk to design out when FCM is added (use data-only payloads) | same |

Consequence for the inbox feature: `components/whatsapp/conversations/inbox.ts` calls `Notification.requestPermission()` and `new Notification(...)` for a new chat while the tab is hidden. Inside the Capacitor WebView `Notification` is undefined, so the guard `'Notification' in window` is false and the toast silently never appears. On desktop Chrome it works as a plain page notification (no service worker, so only while the tab is open).

Sample expected notification from the brief ("Payment reminder, ₹2,500 is due from Rahul Traders") cannot be produced on Android by the current code. The in-app equivalent that does exist is the bell row "Invoice INV-xxx is overdue — Rahul Traders's invoice for ₹2500.00 was due on 29/10/2026" (`lib/payment-reminder-delivery.ts`), which the web bell and the Flutter list both render.

## B. Sound and vibration

| Check | Result |
| --- | --- |
| Channels created, ids, names, importance | None exist (verified, both apps). |
| Default sound | Not configured anywhere. The only "sound" in the codebase is the WhatsApp inbox beep generated with `AudioContext` oscillators (`inbox.ts`), which plays inside the page while it is open and is subject to the WebView's autoplay policy. |
| Vibration | Only in the admin Web Push service workers (`vibrate: [200, 100, 200]`); Chrome on Android honours it for the admin PWA, nothing else. |
| Channel creation before delivery, lower-importance existing channel | Not applicable yet. Rule for the future implementation: create the channel in `Application.onCreate` before any FCM message can arrive, never delete and recreate a channel to raise importance (Android keeps the user's choice), and ship a new channel id if a louder default is ever required. |
| Sound controllable in app settings | No app setting mentions device sound. Settings → WhatsApp → Notifications configures WhatsApp reminder *messages*, not device notifications. Nothing in the UI promises a sound. |
| Silent / Do Not Disturb / notifications disabled | Not applicable: nothing posts. |

## C. Android permissions and OS behaviour

| Check | Capacitor shell | Flutter owner app |
| --- | --- | --- |
| `POST_NOTIFICATIONS` declared | No (manifest and `aapt2` dump, verified) | No (verified) |
| Runtime permission request | None; `MainActivity` registers the Bluetooth plugin only | None |
| Settings and recovery guidance | None for device notifications. The admin PWA (`AdminPwaChrome.tsx`) has good copy for blocked permissions in Chrome; nothing equivalent for business users. | None |
| Heads-up eligibility | Needs a channel with `IMPORTANCE_HIGH`; none exists | same |
| Lock-screen privacy | Not applicable; when built, invoice amounts and customer names should use `VISIBILITY_PRIVATE` with a public version ("New payment reminder") because the body contains customer and money data | same |
| Battery optimisation | Not applicable (no background service). The SSE stream dies when Android suspends the WebView; `lifecycle.ts` reconnects on `resume` (code-level, uses `@capacitor/app`). | the app reads notifications on shell start only |
| Target SDK | 36 (Android 16) for both apps, verified. On 13+ the permission model applies. | 36 |

Other requested permissions seen in the Capacitor debug APK that the manifest does not list directly (`USE_BIOMETRIC`, `USE_FINGERPRINT`, `ACCESS_NETWORK_STATE`, `WRITE_CONTACTS`) come from merged plugin manifests; not notification related.

## D. What business users do get on Android today (code-level, confirmed on the emulator up to the login screen)

- Capacitor shell: the web bell and reminder popups inside the WebView, live through SSE while the app is in the foreground; after resume the stream reconnects and the list is re-read. Nothing while the app is in the background, swiped away, or the phone is locked.
- Flutter app: unread badge computed once at shell start from the last 20 notifications; the notifications screen lists 20, marks read, and opens invoices, suppliers, todo, store enquiries, GST compliance and WhatsApp conversations. Supplier Hub rows (orders, money notices, new arrivals), store, khata and subscription rows are shown but not tappable (no phone screen; `notificationTarget` returns null).
- WhatsApp messages from the business's own number or the platform number for reminders and Supplier Hub updates, when the templates are approved (QA F-013: the hub template is still a draft on staging).

## E. Verdict for this phase

Appearance, sound, permission and tap tests are **not applicable** rather than failed: the apps contain no notification code. The emulator run proves the negative (no channels, no permission, no `Notification` API in the WebView). Everything in sections A to C becomes testable only after the FCM work in `03-fcm-and-registration.md` is built.
