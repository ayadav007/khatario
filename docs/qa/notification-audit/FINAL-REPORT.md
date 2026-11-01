# Khatario notification system audit: final report

Date: 2026-10-29. Repository `0406fa3a` plus the uncommitted Supplier Hub work. Phase files: `01-architecture.md`, `02-backend-reliability.md`, `03-fcm-and-registration.md`, `04-android-ux.md`, `05-test-matrix.md`, `06-automated-tests.md`, `07-remediation.md`, screenshots in `evidence/`. Push build-out (later the same day): `08-push-implementation.md`, `09-firebase-setup.md`, `10-android-verification.md`; this file's part B.

Evidence labels used throughout: **verified** (a command, test or device dump produced it), **code-level** (read in the source), **blocked** (could not be run here).

---

# Part B: push notification implementation (update, 2026-10-29)

## B1. Executive summary

Both Android audiences now have a complete push path in the code: the Capacitor shell `com.khatario.app` (tenants' customers) and the Flutter app `com.khatario.phone` (tenants). The server keeps the in-app system untouched and adds a transactional outbox: every `notifications` row becomes a `push_jobs` row by trigger, customer-facing WhatsApp events queue customer jobs, and the existing `todo-reminder-worker` process (plus a cron fallback) sends through Firebase Cloud Messaging with per-device delivery rows, retries with backoff, dead-token revocation and session-aware device cleanup. Tokens are bound to an audience decided by the server from the signed-in identity (business user or store customer of one shop), so a tenant's alert can never be addressed to a customer device and a customer message never to a staff phone; the database test suite proves it with two businesses, a shared member and a store customer.

What is **not** done, and cannot be done from this repository: the Firebase project, the two `google-services.json` files and the server service account (`09-firebase-setup.md`). Until those exist, no push is delivered anywhere; registration fails softly in both apps and every job is marked `failed: fcm_not_configured` rather than lost. Because of that, and because this machine could not sign a device in (see B9/B10), **end-to-end delivery, FCM sound and FCM heads-up behaviour are not verified**. What was verified on the emulator is the native side that does not need Firebase: the channel with high importance, default sound and vibration is created at app start, the permission is declared, and a notification posted on that channel by the shell shows the Khatario icon, title and body and routes its tap into the WebView.

Verdict for this part: **conditionally ready**. Code complete with tests; blocked on the Firebase Console and a signed-in device run before it can be called working.

## B2. What was built

See `08-push-implementation.md` §3–§5 for the file-level description. In one paragraph: migration 445 (`push_devices`, `push_jobs`, `push_deliveries`, trigger `notifications_enqueue_push`); `lib/push/` (FCM wrapper, payload, error classes, device registry, SKIP LOCKED dispatcher, customer enqueue, LISTEN/poll loop); routes `POST|DELETE /api/push/devices`, `POST|DELETE /api/public/store/[subdomain]/push/devices`, `GET|POST /api/cron/dispatch-push`; the hook in `notifyBusinessEvent`; the loop in `todoReminderWorker.ts`; Capacitor plugins, manifest, channel in `KhatarioApplication.java`, small icon, web registration/tap components and sign-out revocation; Flutter `firebase_messaging` + `flutter_local_notifications`, conditional google-services plugin, manifest, icon, `push_service.dart`, wiring in `main.dart` and `app_shell.dart`.

## B3. Tests and builds

| Set | Command | Result |
| --- | --- | --- |
| Push unit + route tests | `npx jest tests/lib/push tests/security/push-devices-route.test.ts` | 3 suites, 20 passed |
| Push database tests on `kh_phase2_test` | `tests/db/push-dispatch.db.test.ts` (runner in `06-automated-tests.md`) | 8 passed: trigger, isolation, stale session, dead token, retry without resend, give-up, two concurrent workers, re-fire, FCM unconfigured |
| Notification suites from the audit (regression) | see B11 | see B11 |
| Type check | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| Flutter analysis and tests | `flutter analyze`; `flutter test test/push_tap_test.dart test/search_notifications_test.dart` | no errors (4 pre-existing warnings/info); 5 passed |
| Capacitor APK | `android/gradlew.bat assembleDebug` (JDK 21; the npm script's bare `gradlew.bat` is not found when Node spawns it from Git Bash) | BUILD SUCCESSFUL, `app-debug.apk` versionCode 5 / 1.4.0 with `POST_NOTIFICATIONS` |
| Flutter APK | `flutter build apk --debug --flavor owner` | see B11 (the first attempts failed on core-library desugaring, then on machine memory) |

## B4–B8. Device evidence, blocked tests, risks, manual actions, deployment checklist

Recorded in `10-android-verification.md` (device matrix with evidence) and `09-firebase-setup.md` (console steps, environment separation, do-not list). Deployment checklist for the push change:

- [ ] Firebase project and both `google-services.json` files in place; APKs rebuilt (`09` §2).
- [ ] `FIREBASE_SERVICE_ACCOUNT_JSON` (or `GOOGLE_APPLICATION_CREDENTIALS`) in staging `.env.production`; `pm2 restart todo-reminder-worker --update-env`.
- [ ] Migration 445 applied on staging (`npm run db:migrate:pending`); it creates tables and triggers only, no backfill, rollback is `DROP TRIGGER … ; DROP TABLE push_deliveries, push_jobs, push_devices`.
- [ ] Crontab line `*/2 * * * * … /api/cron/dispatch-push` (already written into `docs/SERVER_INFRASTRUCTURE.md`).
- [ ] `curl …/api/cron/dispatch-push` reports `"fcm": "ok"`.
- [ ] Device run from `10-android-verification.md` on a staging persona's phone, both apps.
- [ ] Production: same steps, only when asked; never with a staging credential.

## B11. Regression and build results recorded at the end of the session

| Set | Result |
| --- | --- |
| Unit: audit notification suites + push suites (`--maxWorkers=2`) | 21 suites, 223 tests passed (20.4 s) |
| Database on `kh_phase2_test`: 7 audit suites + `push-dispatch` | 8 suites, 70 tests passed (47.6 s). One real defect found by this run and fixed: the first version of the outbox trigger had a `WHEN (NEW.seq …)` clause, which made `notifications.seq` undroppable and broke the Release 2 reset in `notifications-seq.db.test.ts`; the function now reads `seq` through `to_jsonb` with no catalog dependency, and the seq suite (15 tests) passes again |
| `npx tsc --noEmit` | exit 0 |
| `flutter analyze` / `flutter test` (push tap + notifications screen) | no errors / 5 passed |
| Capacitor APK | built (versionCode 5) |
| Flutter APK | BLOCKED by host memory (details in `10-android-verification.md` F1) |
| Device: channel, declared permission, permission prompt and grant | PASS on the emulator (`10-android-verification.md` C1–C4) |
| Device: registration error path, local card with icon, tap event | BLOCKED by host memory (C6, C7, C9) |
| End-to-end FCM delivery, sound, heads-up, background/terminated, two apps | NOT VERIFIED: needs the Firebase Console work and a signed-in device |

## B12. Verdict (push part)

**Conditionally ready.** The server, both app integrations and the isolation rules are implemented and tested; the Android channel and permission flow of the shell are verified on a device. It becomes "ready" only after: the Firebase project and config files exist (`09`), the server credential is set, migration 445 runs on staging, the Flutter APK is built on a machine with memory, and the device matrix rows marked BLOCKED are run with a staging persona on both apps.

---

## 1. Executive summary

Khatario business users have **no Android push notifications**. Neither the Capacitor shell (`com.khatario.app`) nor the Flutter app (`com.khatario.phone`) contains Firebase Cloud Messaging, a push or local-notification plugin, a notification channel, a small icon or the `POST_NOTIFICATIONS` permission. This was verified on an Android 15 emulator: both installed APKs create zero notification channels, request no notification permission, and the Capacitor WebView reports `typeof Notification === 'undefined'` and no `PushManager`. There is no device-token table and no server-side Firebase credential. The only push that exists is Web Push for platform operators on the `/admin` PWA.

What does exist and works: an in-app notification system (31 producers writing to `notifications`, a Server-Sent Events stream with Redis hints and PostgreSQL catch-up, a bell, a notifications page, reminder popups, read state, and a polling list in the Flutter app) with solid tenant isolation and idempotent reminder delivery, covered by 203 unit tests and 62 database tests that all pass.

Two defects were found in that in-app system and fixed with regression tests: the stream did not deliver 28 of 31 notification kinds live while Redis was healthy (N-01, medium), and eight notification kinds opened nothing when tapped (N-02, low). Four lower findings are documented with the action needed.

**Verdict: NOT READY for "reliable, audible, actionable Android notifications"** as the brief defines them, because the feature does not exist. The in-app notification layer that does exist is **conditionally ready** after the two fixes: the browser pass could not be run in this session and the staging crontab still does not run the reminder jobs.

## 2. Architecture discovered (verified unless noted)

- Next.js 14, PostgreSQL, optional Redis/BullMQ. `notifications` table with `seq` cursor, per-user or broadcast rows, `popup_dismissed_at`, 19-value type CHECK. No `createNotification` helper; raw SQL at 31 sites.
- Delivery: `GET /api/notifications` + `GET /api/notifications/stream` (SSE; hints on Redis channel `notifications`; catch-up by `seq`; 10 streams/user, 1000/process; reauth every 5 min). Client store with cross-tab relay and `localStorage` cursor. Flutter app: one list fetch on open.
- Schedulers: todo worker (BullMQ + 30 s sweep, atomic claim), payment reminders every 15 min (per-business window, queue or inline), hourly low stock, daily GST and subscription jobs, 5-minute Supplier Hub outbox. All behind `CRON_SECRET`.
- Push: admin-only Web Push (VAPID keys encrypted in `platform_settings`, `platform_admin_push_subscriptions`, root `/sw.js` handler).
- Android: Capacitor 8 shell loading the remote site (no notification code), Flutter app (no notification code). Full map in `01-architecture.md`.

## 3. Features confirmed working

| Feature | Evidence |
| --- | --- |
| Notification rows are created for todo reminders, invoice views, Supplier Hub orders, with correct business and recipients | DB tests (62 pass) and the Supplier Hub DB suite (30 pass, 2026-10-29) |
| Identity from the session only; cross-business and other-user rows never returned; revoked sessions rejected | `notification-routes-auth.test.ts`, `notification-access.db.test.ts` |
| Todo reminder claimed once across two sweeps and a BullMQ job; re-fire gets a new seq and popup; deleted recipient skipped | `todo-reminder-sweep.db.test.ts`, `notifications-seq.db.test.ts` |
| Stream resume by `Last-Event-ID`, out-of-order commits inside the 120 s window, resync over 1000 rows, limits and 429/503 | `notification-stream.db.test.ts`, `hub.test.ts` |
| Client reconnect, backoff, Retry-After, wake on visibility/online/resume, session switch, cross-tab de-dup | `tests/lib/notifications/client/*` |
| Payment reminder queue vs inline fallback, per-business pacing, quota | `payment-reminder-queue.test.ts` |
| Capacitor and Flutter apps install and launch on Android 15 and reach their sign-in screens | `evidence/*.png`, logcat |

## 4. Features partially implemented

- Admin Web Push: complete for operators but untested by automation; no retry or 429 handling; root `/sw.js` push handler is shipped to every browser user with "Khatario Admin" defaults although no business user is ever subscribed.
- Browser `Notification` toast for the WhatsApp inbox: desktop only; silently absent inside the APK (API undefined).
- `notification_reads` table exists but is unused; broadcast rows share one read flag per business.
- Flutter notification list: no live update, 20 rows, and hub/store/khata rows are not tappable.

## 5. Missing features

- FCM or any OS-level push for business users (Firebase project, `google-services.json`, plugin, permission, channel, small icon, token table, register/refresh/unregister routes, sender, invalid-token cleanup, retries, delivery log, deep-link on tap, foreground/background handling, reboot).
- Delivery receipts of any kind (a row proves creation only).
- A shared notification-creation helper (every producer repeats the SQL; one site forgot the Redis hint pattern 28 times).

## 6. Confirmed bugs and severity

| Id | Severity | Finding | State |
| --- | --- | --- | --- |
| N-01 | Medium | Stream pulled only when Redis hints were unhealthy; 28 producers never publish a hint, so their rows were not delivered live with Redis up | FIXED, regression test |
| N-02 | Low | `invoice_viewed`, money notices, standing orders, purchase orders, subscription, AI agent, WhatsApp session rows opened nothing | FIXED, regression test |
| N-03 | Low (design) | Broadcast read flag shared per business | OPEN, decision needed |
| N-04 | Low | Low-stock alert dedupe not race-safe (no partial unique index) | OPEN, needs data check + index |
| N-05 | Low | Payment-reminder in-app dedupe is check-then-insert | ACCEPTED |
| N-07 | Info | Stream catch-up failures are not logged server-side | OPEN |

## 7. Fixes implemented

`lib/notifications/stream/connection.ts` (heartbeat always pulls while live), `lib/notifications/notification-href.ts` (eight mappings), comments in `lib/notifications/stream/hub.ts` and `tests/db/notification-stream.db.test.ts`, tests in `tests/lib/notifications/stream/hub.test.ts` and `tests/lib/notification-href.test.ts`. Details and root causes in `07-remediation.md`. No migration, no production change, nothing committed.

## 8. Tests executed and results

| Set | Baseline | After fixes |
| --- | --- | --- |
| Notification unit suites (11 paths, 18 suites) | 201 passed | 203 passed |
| Notification DB suites on `kh_phase2_test` (7 suites) | 62 passed | 62 passed |
| New tests before the fix | 2 failed (as designed) | — |
| `npx tsc --noEmit` | — | exit 0 |

Commands are in `06-automated-tests.md`.

## 9. Android device and emulator evidence

Emulator `khatario_pixel`, Android 15 (API 35). Capacitor debug APK (1.3.0, server `https://staging.khatario.com`) and Flutter owner release APK (1.0.0) installed and launched. Verified: `aapt2` badging (no notification permission), `dumpsys package` (no `POST_NOTIFICATIONS`), `dumpsys notification` (0 channels for both packages, 135 for other packages), DevTools evaluation inside the WebView (`Notification` undefined, `PushManager` absent, `sw.js` registered, Capacitor plugin list without push), screenshots `evidence/emu-capacitor-launch.png` and `evidence/emu-flutter-launch.png`. No notification was displayed because none can be.

## 10. Tests blocked by missing access or configuration

- Signed-in browser pass of the stream and tap routing on a local test server: BLOCKED (five dev servers from other chats already use the folder's limit; the local test password read from `.env` was refused by the permission classifier). Steps to run are in `05-test-matrix.md`.
- Admin Web Push on an Android phone (Chrome PWA): BLOCKED (needs an admin login on a device).
- Staging crontab, PM2 and Redis health: not checked (no VPS access from this session; QA F-014 records one cron line on staging).
- Flutter `notificationTarget` change: not made (Flutter not on PATH).
- Mobile-data, DND, silent, permission re-enable cases: N/A until a notification implementation exists.

## 11. Remaining risks

- Users expect phone alerts for reminders and Supplier Hub orders; today they get them only through WhatsApp templates (the hub template is still a draft on staging, F-013) or by having the app open.
- Heartbeat polling adds up to two queries per open stream per 25 s; acceptable at today's scale, revisit with a shared hint helper if streams grow.
- Shared read flag (N-03) can hide a reminder from colleagues after one person reads it.
- Overlapping low-stock runs can double-notify a supplier (N-04).
- Stream failures are silent in server logs (N-07).

## 12. Manual actions required

1. Owner: decide whether phone push is wanted and in which app (Capacitor shell, Flutter, or both); then create the Firebase project and apps, add `google-services.json` per app, and give the server a service account via `.env.production` (never the repo).
2. Ops: add the reminder cron lines to the staging crontab (F-014) and confirm `REDIS_URL` and the `todo-reminder-worker` PM2 process on both environments.
3. Ops: run the duplicate check for `low_stock_alerts` (query in `07-remediation.md`) before any index is added.
4. Admin: submit the `khatario_supplier_hub_update` WhatsApp template (F-013) so hub notifications reach phones at all.
5. Product: decide on per-user read receipts (N-03).
6. QA: run the blocked browser pass in `05-test-matrix.md` once a server slot is free.

## 13. Production deployment checklist (for the two fixes only)

- [ ] Review the diff: `lib/notifications/stream/connection.ts`, `lib/notifications/stream/hub.ts`, `lib/notifications/notification-href.ts`, two test files, one test comment.
- [ ] `npx tsc --noEmit` and the two Jest sets in `06-automated-tests.md` pass (done here on 2026-10-29).
- [ ] No migration is needed; no environment variable changes.
- [ ] Deploy to staging first (`docs/SERVER_INFRASTRUCTURE.md`); open the bell in two tabs, insert one `general` row for the business on the staging database, confirm it appears within 25 s without a reload.
- [ ] Watch PM2 logs and PostgreSQL load for an hour: the new per-stream heartbeat query should be invisible at current traffic.
- [ ] Production deploy only when asked.

## 14. Final verdict

**Not ready** for Android push notifications: the capability is absent, not broken, and needs the build-out listed in §5 and §12 before any appearance, sound or tap test can be run. The existing in-app notification system is **conditionally ready**: its generation, isolation and idempotency are verified by tests; live delivery of every notification kind is fixed and unit-tested; the conditions are the blocked browser pass, the staging crontab, and the open low-severity items above.
