# Notification audit, Phase 6: automated tests

Date: 2026-10-29. Framework: Jest (`ts-jest`), database suites gated on `PHASE2_TEST_DATABASE_URL` pointing at `kh_phase2_test` (`127.0.0.1:5433`; `current_database()` printed `kh_phase2_test` before the runs). No Android instrumentation or Flutter tests were added: the Flutter toolchain is not on this machine's PATH and the apps contain no notification code to test.

## Tests added

| File | Test | Covers | Before fix | After fix |
| --- | --- | --- | --- | --- |
| `tests/lib/notifications/stream/hub.test.ts` | "delivers a row inserted without a hint on the next heartbeat while Redis is healthy" | N-01: a broadcast row inserted with no Redis hint reaches an open stream at the next 25 s heartbeat, and is not re-sent by later heartbeats | FAIL (0 messages after 25 s) | PASS |
| `tests/lib/notification-href.test.ts` | "opens the record behind every notification kind that has a page" | N-02: tap destinations for `invoice_viewed` (`invoices`), `supplier_hub_money`, `supply_standing_order`, `purchase_order`, `subscription`, `ai_agent`, `whatsapp_session`, `khata_customer` | FAIL (first assertion returned null) | PASS |

## Coverage map against the brief

| Area | Existing test(s) | Result 2026-10-29 |
| --- | --- | --- |
| Notification creation | `tests/db/todo-reminder-sweep.db.test.ts`, `tests/db/notifications-seq.db.test.ts`, `tests/db/notification-access.db.test.ts` (invoice viewed recipients) | PASS |
| Recipient authorization and business isolation | `tests/security/notification-routes-auth.test.ts`, `tests/db/notification-access.db.test.ts`, `tests/security/notification-popup-dismiss-route.test.ts` | PASS |
| Title and message generation | todo: `tests/lib/todo-reminders/process-reminder-job.test.ts`; payment: `tests/lib/payment-reminder-queue.test.ts` (outcomes), text assembled in `payment-reminder-delivery.ts` is not asserted | PASS / partial |
| Device-token registration and refresh | none: no feature | NOT TESTED (not applicable) |
| FCM payload construction | none: no feature | NOT TESTED (not applicable) |
| Foreground/background handling | web stream lifecycle: `tests/lib/notifications/client/*` (visibility, online, resume, cross-tab relay) | PASS |
| Duplicate prevention and concurrent workers | `tests/db/todo-reminder-sweep.db.test.ts` (two sweeps + BullMQ job on the same todo), `tests/db/notification-stream.db.test.ts` (out-of-order commits, overlap window), `tests/lib/payment-reminder-queue.test.ts` (job ids) | PASS |
| Retry and transient provider failures | todo: BullMQ failure rethrow in `process-reminder-job.test.ts`; stream: `hub.test.ts` reconnect after Redis drop; payment: queue unavailable → inline fallback | PASS. Admin Web Push send errors: NOT TESTED |
| Invalid-token cleanup | none (admin Web Push 404/410 path has no test) | NOT TESTED |
| Scheduler batch and timeout | `tests/lib/todo-reminders/sweep-position.test.ts` (wall clock, batch limit, resume position), `tests/security/check-reminders-route.test.ts` | PASS |
| Notification tap routing | `tests/lib/notification-href.test.ts` (now 4 tests) | PASS |
| Logout and account switching | `tests/lib/notifications/client/stream-integration.test.ts` (session switch resets cursor and store), `notification-routes-auth.test.ts` (revoked session → 401, cross-business → 403) | PASS |
| Permission-denied handling | none (no Android permission code) | NOT TESTED (not applicable) |

## Commands and results

Unit (no database):

```bash
npx jest tests/lib/notifications tests/lib/notification-href.test.ts tests/security/notification-routes-auth.test.ts tests/security/notification-popup-dismiss-route.test.ts tests/security/check-reminders-route.test.ts tests/security/customer-send-reminder-route.test.ts tests/lib/todo-reminders tests/lib/payment-reminder-queue.test.ts tests/lib/reminder-schedule.test.ts tests/lib/subscription/lifecycle-notifications.test.ts tests/lib/more-navigation-payment-reminders.test.ts
```

| Run | Suites | Tests | Time |
| --- | --- | --- | --- |
| Baseline (before changes) | 18 passed | 201 passed | 10.2 s |
| After changes | 18 passed | 203 passed | 26.1 s |

Database (`PHASE2_TEST_DATABASE_URL` built from `.env` `DB_*` with database `kh_phase2_test`, the same rule as `tests/live/run-security-regressions.mjs`; the URL was never printed):

```bash
npx jest tests/db/notification-access.db.test.ts tests/db/notification-initial-cursor.db.test.ts tests/db/notification-popup-dismiss.db.test.ts tests/db/notification-stream.db.test.ts tests/db/notifications-seq.db.test.ts tests/db/order-notify.db.test.ts tests/db/todo-reminder-sweep.db.test.ts --runInBand --forceExit
```

| Run | Suites | Tests | Time |
| --- | --- | --- | --- |
| Baseline | 7 passed | 62 passed | 57.7 s |
| After changes | 7 passed | 62 passed | 31.3 s |

Type check: `npx tsc --noEmit -p tsconfig.json` exit 0 after the changes.

Pre-existing failures: none in these suites. The repository-wide failures recorded in `docs/qa/scan-add-items-results.md` (6 Jest suites, 17 Flutter goldens) were not re-run and are unrelated to notifications.

## Tests that could not be written here

- Android display, channel, sound, permission, tap-from-closed-app: no implementation to test (see `04-android-ux.md`).
- Admin Web Push subscribe/send: needs a platform-admin session and VAPID keys; the routes are small wrappers over `lib/platform-push.ts`, which calls `web-push` directly. A unit test with a mocked `web-push` is possible; not added because the brief's scope is business-user notifications and nothing in that path was changed.
