# Push notifications: implementation (FCM for both Android apps)

Date: 2026-10-29. Builds on the audit in `01`–`07` and `FINAL-REPORT.md` (first section). Nothing is committed or deployed; migration 445 is applied to `kh_phase2_test` only. Firebase Console work is still open (`09-firebase-setup.md`), so no real push has been sent anywhere.

## 1. Starting point re-checked

The working tree still carried the audit's two fixes (`notification-href.ts`, `stream/connection.ts`) and the Supplier Hub pricing work; nothing else in the notification path had changed since the audit (`git status`, `git log -3` at `0406fa3a`). Application ids verified again from the APK badging: `com.khatario.app` (Capacitor, now versionCode 5 / 1.4.0) and `com.khatario.phone` (Flutter owner flavour). The audit's "no FCM, no channel, no permission" findings were the baseline for this work.

## 2. Audiences and isolation (the design rule everything else follows)

Two kinds of people hold these apps, and their alerts must never cross:

| Audience | Who | Identity | Registered through | Receives |
| --- | --- | --- | --- | --- |
| `business` | tenants, their staff, anyone signed in to the business app | `users.id` | `POST /api/push/devices` (middleware-verified session) | rows of `notifications` for a business they are a member of |
| `customer` | a shop's store customers | `store_customers.id` + the shop's `business_id` | `POST /api/public/store/[subdomain]/push/devices` (store customer cookie of that shop) | customer-facing messages of that shop only |

The audience of a token is **decided by the server from the authenticated identity** at registration, never from the request body (the route tests prove a body `audience`/`user_id`/`customer_id` is ignored). The same APK can therefore serve either audience: the business sign-in registers a business device, the store account sign-in registers a customer device, and the row's CHECK constraint (`chk_push_devices_owner`) makes a row with both impossible.

At send time (`lib/push/dispatcher.ts#resolveJobDevices`):

- a business job joins `push_devices` to `users` and requires membership of the job's business through `users.business_id` or `user_businesses`, the same rule as `userBelongsToSessionBusiness`; a per-user job (`user_id` set) additionally requires that user. Customer devices are excluded by `audience = 'business'`.
- a customer job selects `audience = 'customer' AND customer_id = $job AND business_id = $job`, joined back to `store_customers` of that business. Business devices are excluded by construction.
- a business device whose stored `session_version` differs from `users.auth_session_version` is revoked (`session_ended`) instead of being sent to: the phone was signed out, or replaced on a single-device plan.

Covered by `tests/db/push-dispatch.db.test.ts` ("broadcasts reach every member device of that business and nothing else": two businesses, a user in both, a store customer of the first; the customer device and the other business's device never appear in the sender's calls; a customer job reaches only the customer device; a customer message for the same phone at another shop queues nothing).

## 3. Backend

### Schema (migration `445_push_notifications.sql`, mirrored in `database/schema.sql`)

- `push_devices`: token (unique), `token_hash` (sha256, what logs and delivery rows carry), audience, owner, `app_id`, `platform`, `environment`, `session_version`, `device_label`, `app_version`, `last_seen_at`, `revoked_at`, `revoked_reason`.
- `push_jobs`: the outbox. `kind` (`notification` or `customer`), `audience`, `notification_id` + `notification_seq`, `business_id`, `user_id` (NULL = every member), `customer_id`, `title`, `body`, `data`, `status` (`pending`, `sent`, `failed`, `skipped`), `attempts`, `next_attempt_at`, `locked_at`, `last_error`, `sent_count`. Unique on `(notification_id, notification_seq)` so one notification occurrence is one job; a todo re-fire has a new `seq` and gets a new job.
- `push_deliveries`: one row per device per attempt (`accepted`, `retry`, `invalid_token`, `failed`, FCM error code, provider message id, token hash).
- Trigger `notifications_enqueue_push` AFTER INSERT and AFTER UPDATE (when `seq` changes) on `notifications` → inserts the job and `pg_notify('push_jobs')`. The job commits with the producer's transaction, so the 31 existing producers needed no change and a rolled-back producer leaves no job.

### Library `lib/push/`

| File | Role |
| --- | --- |
| `types.ts` | audiences, app ids, channel id, row and message types, `PushSender` interface |
| `fcm.ts` | lazy `firebase-admin` start from `FIREBASE_SERVICE_ACCOUNT_JSON` (raw or base64) or `GOOGLE_APPLICATION_CREDENTIALS`; `sendEachForMulticast` in batches of 500; a whole-batch failure is a retry for every token; `tokenHash()` / `tokenRef()` for logs; `fcmUnavailableReason()` for health |
| `payload.ts` | one message per job: `notification` {title, body} so Android displays it in the background and when the app is closed without app code; `data` {kind, audience, business_id, notification_id, notification_seq, href, type, title, body, channel} for foreground display and tap routing; `android` {priority high, ttl 24 h, collapse key, channel `khatario_alerts`, icon `ic_stat_khatario`, colour, default sound, tag = notification id, visibility private, default vibrate}. Title ≤ 80, body ≤ 240 characters. `href` comes from `notification-href.ts` (the same mapper the bell uses) |
| `errors.ts` | FCM error classes: `invalid_token` (not-registered, invalid token, mismatched credential → revoke), `retry` (unavailable, internal, rate limits, batch failure, network), `failed` (everything else); backoff 30 s, 2 min, 10 min, 1 h, then give up (5 attempts) |
| `device-registry.ts` | `registerPushDevice` (upsert by token; a token moves to whoever signs in on that phone; business rows store the user's session version), `revokePushDevice` (owner-scoped), `revokeDeviceById` |
| `dispatcher.ts` | `dispatchPushJobs`: claims due jobs with `FOR UPDATE SKIP LOCKED` and `locked_at` (a lock older than 5 min expires), resolves devices, skips devices that already have an `accepted` delivery for the job, sends, writes deliveries, revokes dead tokens, retries or finishes. Mixed results: any retryable device keeps the job pending for the next attempt (only those devices are sent again). No sender configured: job `failed` with `fcm_not_configured`; no devices: `skipped` with `no_devices`. The notification row is never touched |
| `customer-push.ts` | `enqueueCustomerPush`: allowlist of customer-facing WhatsApp events (order lifecycle, payment reminders, khata) with a title and the store page to open; finds the store customer of that shop by phone digits and queues a job only if that customer has a live device for that shop |
| `dispatch-loop.ts` | long-running loop: `LISTEN push_jobs` on a dedicated connection plus a 10 s poll (retries, missed notifies); rounds never overlap in-process |

### Entry points

- `POST|DELETE /api/push/devices` (business), `POST|DELETE /api/public/store/[subdomain]/push/devices` (customer). Both derive identity from the session/cookie; `app_id` must be one of the three Khatario ids; token sanity checks; `DELETE` only revokes the caller's own token.
- `lib/workers/todoReminderWorker.ts` starts `startPushDispatchLoop()` (off with `PUSH_DISPATCH_DISABLED=1`). This is the process that sends in staging/production (PM2 `todo-reminder-worker`).
- `GET|POST /api/cron/dispatch-push` (`CRON_SECRET`): fallback for when the worker is down; runs rounds for up to 25 s; reports `fcm: ok | fcm_not_configured | fcm_init_failed`.
- `lib/whatsapp/tenant-send.ts#notifyBusinessEvent` calls `enqueueCustomerPush` before the WhatsApp attempt, so every existing customer-facing event (fulfilment steps, store order placed/paid/shipped, payment reminders, khata opened/order/statement/overdue) also reaches the customer's phone app. Merchant-facing keys (`merchant_*`) are not in the allowlist; those reach the business audience through `notifications` as before.

### Reliability properties (verified by `tests/db/push-dispatch.db.test.ts`, 8 cases)

- trigger creates exactly one job per notification occurrence; re-fire → second job; read updates → no job;
- two concurrent dispatchers over 8 jobs: disjoint claims, each job sent once;
- transient error → `retry` delivery row, job pending with backoff, next attempt resends only to the device that failed, `sent_count` counts both;
- five transient attempts → `failed` ("gave up after 5 attempts");
- dead token → device revoked `fcm_unregistered`, the other device still delivered;
- session version bump → device revoked `session_ended`, job skipped; a new sign-in with the same token re-activates the same row;
- FCM not configured → job `failed`, notification row untouched (`is_read` still false).

## 4. Capacitor shell (`com.khatario.app`)

- Plugins added: `@capacitor/push-notifications@8.1.3`, `@capacitor/local-notifications@8.3.1` (`npx cap sync android` done; `capacitor.build.gradle` now lists both).
- `AndroidManifest.xml`: `POST_NOTIFICATIONS`; Firebase default icon, colour and channel meta-data.
- `KhatarioApplication.java`: creates channel `khatario_alerts` (IMPORTANCE_HIGH, default notification sound, vibration pattern, lock-screen private) in `onCreate`, before any `MessagingService` can run; `createNotificationChannel` is a no-op for an existing id, so user changes survive.
- `res/drawable/ic_stat_khatario.xml` (white silhouette "K" mark) and `res/values/colors.xml` (`khatario_notification_accent`).
- `build.gradle` / `capacitor.config.ts`: versionCode 5, 1.4.0 (native permission and plugins changed).
- Web: `lib/push/client/capacitor-push.ts` (permission check/request after sign-in, `register()`, token → the audience's route, `pushNotificationReceived` in the foreground → `LocalNotifications.schedule` on `khatario_alerts` with the same icon and a stable id, system and local taps → `planPushTap`), `lib/push/client/tap-route.ts` (site-path-only routing, business switch detection), `components/system/PushRegistration.tsx` (mounted in the app shell layout; switches business through `POST /api/businesses/switch` when the alert is for another business, then full-loads the page), `components/store/StorePushRegistration.tsx` (mounted in `StoreApp`; registers the store customer for that shop), `components/notifications/PushPermissionNotice.tsx` (on `/notifications`, explains the Android settings path when the permission is denied), `AuthContext.logout` and `store-context.signOutCustomer` revoke the device before the cookie is cleared.
- Foreground duplicates: Android never shows a push while the app is in the foreground, and the plugin does not either, so the local notification is the only card; in the background only FCM's card appears. The todo popup inside the page can appear alongside the card for todo reminders (in-app modal + shade), which is the same behaviour as WhatsApp-style apps.
- Without `google-services.json` the build still succeeds (the google-services plugin is skipped), `register()` fails with a `registrationError` which is logged, and everything else (bell, stream, local notifications) works.

The shell loads the remote site, so the web side above only runs on a phone once it is deployed to staging/production.

## 5. Flutter phone app (`com.khatario.phone`)

- `pubspec.yaml`: `firebase_core ^4`, `firebase_messaging ^16`, `flutter_local_notifications ^22.3.3` (19.x conflicts with `pdf 3.13.1` over `xml`). `flutter pub get` resolved them.
- Gradle: `settings.gradle.kts` declares `com.google.gms.google-services` 4.4.2; `app/build.gradle.kts` applies it only when `google-services.json` exists.
- `AndroidManifest.xml`: `POST_NOTIFICATIONS`; Firebase default icon, colour and channel meta-data. `res/drawable/ic_stat_khatario.xml`, `res/values/colors.xml` (existing `khatario_background` kept).
- `lib/push/push_service.dart`: `init()` at startup (local plugin, channel `khatario_alerts` high importance with sound and vibration, cold-start tap from a local card, then `Firebase.initializeApp()` guarded: without the config file `firebaseReady` is false and nothing else runs); `registerForSession(api)` after a session loads (Android 13 permission, token, `POST /api/push/devices` with `app_id com.khatario.phone`); `onTokenRefresh` re-posts while signed in; `onMessage` → local card on the channel with icon, colour, private visibility, a tag per notification and big-text style; `onMessageOpenedApp` and `getInitialMessage` → `pendingTap`; `unregister(api)` before `POST /api/auth/logout`. No background message handler is registered: with a `notification` payload Android displays the card itself when the app is in the background or closed, so a handler would only risk a duplicate.
- `main.dart`: `PushService.instance.init()` in `main`, `registerForSession` in `_loadSession`, `unregister` in `_signOut`, `pushTaps` passed to `AppShell`.
- `shell/app_shell.dart`: listens to `pushTaps`; an alert for another business the user belongs to calls `POST /api/businesses/switch` and reloads the session (the tap stays pending until the shell for that business picks it up); otherwise routes with the notification screen's `notificationTarget` (invoice, supplier) or the href catalogue (`_openFromMore`, which opens the phone screen or the website page inside the app), falling back to the notifications screen.
- `api.dart`: `deleteJson` accepts a body (the token).
- `PushTap` is a pure class with the same path rules as the web `safeSitePath` (`test/push_tap_test.dart`).
- The staff flavour (`com.khatario.staff`, `main_staff.dart`) is not wired; it has no notifications screen today.

## 6. Notification types and routing

Business audience: every existing `type` is pushed with the bell's title and message and the bell's destination (`notification-href.ts`, extended in the audit so `invoice_viewed`, hub money notices, standing orders, purchase orders, subscription, AI agent and WhatsApp session rows open a page). Titles are the producers' own ("Invoice INV-7 is overdue", "Reminder: …", "Low stock at …", "New supplier connection request", …). Lock-screen visibility is private because bodies carry customer names and amounts.

Customer audience: the WhatsApp event text (`fallbackText`) is the body; titles and pages come from `CUSTOMER_PUSH_EVENTS` (`/account` for orders and reminders, `/khata` for khata events). No new business event was invented; the hook sits on the existing event sender.

## 7. Changed files

Backend: `database/migrations/445_push_notifications.sql`, `database/schema.sql`, `lib/push/{types,fcm,payload,errors,device-registry,dispatcher,customer-push,dispatch-loop}.ts`, `lib/push/client/{tap-route,capacitor-push}.ts`, `app/api/push/devices/route.ts`, `app/api/public/store/[subdomain]/push/devices/route.ts`, `app/api/cron/dispatch-push/route.ts`, `lib/whatsapp/tenant-send.ts`, `lib/workers/todoReminderWorker.ts`, `package.json` (+ `firebase-admin`, two Capacitor plugins).
Web: `components/system/PushRegistration.tsx`, `components/store/StorePushRegistration.tsx`, `components/notifications/PushPermissionNotice.tsx`, `app/(app)/layout.tsx`, `app/(app)/notifications/page.tsx`, `components/store/StoreApp.tsx`, `contexts/AuthContext.tsx`, `lib/store/store-context.tsx`.
Capacitor: `android/app/src/main/AndroidManifest.xml`, `.../KhatarioApplication.java`, `.../res/drawable/ic_stat_khatario.xml`, `.../res/values/colors.xml`, `android/app/build.gradle`, `android/app/capacitor.build.gradle` (generated), `capacitor.config.ts`.
Flutter: `phone/pubspec.yaml`, `phone/pubspec.lock`, `phone/android/settings.gradle.kts`, `phone/android/app/build.gradle.kts`, `phone/android/app/src/main/AndroidManifest.xml`, `.../res/drawable/ic_stat_khatario.xml`, `.../res/values/colors.xml`, `phone/lib/push/push_service.dart`, `phone/lib/main.dart`, `phone/lib/shell/app_shell.dart`, `phone/lib/api.dart`, `phone/test/items_golden_test.dart` (fake signature).
Tests: `tests/lib/push/{payload,tap-route}.test.ts`, `tests/security/push-devices-route.test.ts`, `tests/db/push-dispatch.db.test.ts`, `phone/test/push_tap_test.dart`.
Docs: this file, `09-firebase-setup.md`, `10-android-verification.md`, `FINAL-REPORT.md`, `docs/SERVER_INFRASTRUCTURE.md` (worker and cron), `docs/qa/README.md`, `docs/qa/route-inventory.md`, `docs/project.log.md`.

## 8. Open items in the implementation itself

- Staff flavour push.
- Per-business or per-user "quiet" preference (no producer-level opt-out exists for the bell either).
- Delivery receipts from the device (FCM "accepted" is the provider accepting the message, not the phone showing it); only a device-side acknowledgement could close that gap.
- `environment` is `production` unless an app passes it; the staging APK does not yet pass `environment: 'staging'` (one-line follow-up in both apps once the two-project setup in `09` is chosen).
