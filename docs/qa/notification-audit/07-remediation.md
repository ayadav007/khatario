# Notification audit, Phase 7: remediation

Date: 2026-10-29. Nothing committed, nothing deployed, no migration written. Every change is in the working tree.

## Fix 1: SSE stream delivers rows that never got a Redis hint (N-01, Medium)

- **Files:** `lib/notifications/stream/connection.ts` (heartbeat), comment in `lib/notifications/stream/hub.ts`, comment in `tests/db/notification-stream.db.test.ts`.
- **Root cause:** `heartbeat()` pulled from PostgreSQL only while `hintsHealthy()` was false. With Redis up, delivery depended on a `notifications` channel hint, which only three of thirty-one producers publish. Every other kind (payment reminders, Supplier Hub orders and money notices, low stock, GST, store enquiries, khata, subscription, credit approvals) sat in the table until the user reopened the bell or the stream reconnected.
- **Change:** the heartbeat pulls on every tick while the stream is live. The pull reads from the overlap floor with two index lookups (`idx_notifications_business_user_seq`) and writes nothing when there is nothing new; the existing window de-duplication prevents re-sends. Hints keep their sub-second path.
- **Cost:** at most two queries per open stream per 25 s. At the process limit of 1000 streams that is 80 small queries/s; staging and production today have far fewer open tabs. If this ever matters, the right next step is a shared `publishNotificationHint()` called from every insert site, not a return to hint-only delivery.
- **Tests:** new case in `tests/lib/notifications/stream/hub.test.ts` (failed before, passes after); the existing "polls while Redis is down" and "polls while the publisher is down" cases still pass; `tests/db/notification-stream.db.test.ts` 7 cases pass on `kh_phase2_test`.

## Fix 2: notifications that opened nothing now open their record (N-02, Low)

- **File:** `lib/notifications/notification-href.ts`.
- **Root cause:** producers used reference types the mapper did not know: `invoices` (plural, from `lib/customer-surface/record-view.ts`), `supplier_hub_money`, `supply_standing_order`, `purchase_order`, `subscription`, `ai_agent`, `whatsapp_session`.
- **Change:** `invoices` is treated like `invoice`; money notices open `/suppliers/hub` (where the Money section lives); standing orders open `/supply-orders`; purchase orders open `/purchase-orders/{id}`; subscription, AI agent and WhatsApp session rows open their settings pages. `quantity_request` still returns null: there is no page for stock requests.
- **Tests:** new case in `tests/lib/notification-href.test.ts` (failed before, passes after). The web bell (`NotificationCenter.tsx`, `NotificationPanel.tsx`) and the `/notifications` page all call this mapper, so no component changed. Browser click-through was BLOCKED (see Phase 5).
- **Not changed:** the Flutter app has its own `notificationTarget` (`phone/lib/screens/notifications/notifications_screen.dart`) with the same gaps for hub, store and khata rows. The Flutter toolchain is not on this machine's PATH, so the change could not be run; listed as a manual follow-up.

## Not fixed, with reasons

| Finding | Why not here | What to do |
| --- | --- | --- |
| No Android push at all | New architecture (Firebase project, plugin, permission, channel, token table, sender, delivery log). Needs Firebase Console access and a decision on which Android app ships. | Plan in `03-fcm-and-registration.md` §"What would be needed"; checklist in `FINAL-REPORT.md`. |
| N-03 shared read flag on broadcast rows | Product decision (per-user read receipts change what "Mark all read" means for a team) and a backfill; `notification_reads` already exists for it. | Decide, then switch `read-state.ts` to `notification_reads` for `user_id IS NULL` rows. |
| N-04 low-stock dedupe under overlapping runs | Needs a partial unique index; creating it fails if staging or production already holds duplicate active alerts. | Check `SELECT supplier_business_id, customer_business_id, item_id, count(*) FROM low_stock_alerts WHERE alert_status='active' GROUP BY 1,2,3 HAVING count(*)>1` on each database, resolve duplicates, then add the index and `ON CONFLICT DO NOTHING`. |
| N-05 payment-reminder in-app dedupe | Race is theoretical given unique job ids; a unique index per invoice per day would need a migration. | Leave; revisit with the FCM delivery log. |
| N-07 silent stream failures | Adding log lines is a judgement call for the owner (volume on PM2 logs). | Log `failAndReconnect` with connection id, scope and error class, no message text. |
| Inbox `Notification` toast inside the APK | Needs native notifications (same FCM/local-notification work). | Covered by the push work. |
| Staging crontab (F-014) | Ops action on the VPS. | Add the lines from `docs/SERVER_INFRASTRUCTURE.md`. |

## Verification after the fixes

| Check | Command | Result |
| --- | --- | --- |
| Notification unit suites | see `06-automated-tests.md` | 18 suites, 203 tests passed |
| Notification DB suites on `kh_phase2_test` | see `06-automated-tests.md` | 7 suites, 62 tests passed |
| Type check | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| Browser pass | `05-test-matrix.md` §"How to run" | BLOCKED (server limit, credential read refused) |
| Android device | Emulator run before the fixes; the fixes touch no Android code | Not repeated; nothing to re-verify on the device |
