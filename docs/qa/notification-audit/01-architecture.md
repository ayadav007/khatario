# Notification audit, Phase 1: architecture actually present

Date: 2026-10-29. Repository at `0406fa3a` plus uncommitted Supplier Hub work. Every statement below is marked as **verified** (run or dumped), **code-level** (read in the source) or **not checked**.

## Executive finding

Khatario has **no Android push notification system**. There is no Firebase project file, no FCM SDK, no Capacitor or Flutter push plugin, no device-token table for business users, no notification channel and no `POST_NOTIFICATIONS` permission in either Android app. What exists is:

| Layer | What it is | Reaches |
| --- | --- | --- |
| In-app notifications | `notifications` table, bell, `/notifications` page, reminder popups, Server-Sent Events (SSE) stream | Web app, Capacitor APK WebView (while open), Flutter phone app (poll on open) |
| Web Push (VAPID, `web-push`) | Platform **admin** only, `/admin` PWA, `platform_admin_push_subscriptions` | Operators' Chrome. Not business users. |
| Browser `Notification` API | WhatsApp inbox: desktop toast + beep for a new chat when the tab is hidden | Desktop browsers only. Undefined inside the Android WebView (verified). |
| WhatsApp / email | Payment reminders, todo reminders (optional), Supplier Hub outbox, khata, subscription lifecycle | Customers and owners by phone/email; not an OS notification of the app |

The "notification" the roadmap and users would expect on a phone (banner, sound, tap to open) does not exist for business users today. Phases 3 and 4 therefore audit what is there and record the full list of work needed, rather than tuning an integration.

## Stack (verified from `package.json`, `android/`, `phone/`)

- Next.js `^14.0.0`, App Router, Node runtime API routes under `app/api`. No server actions in the notification path.
- PostgreSQL via `pg` (`lib/db.ts`); tests use the disposable `kh_phase2_test` on `127.0.0.1:5433` (confirmed with `current_database()` in this audit).
- Redis (ioredis, BullMQ) optional: `REDIS_URL`. On this machine Redis was **not** reachable during the audit (`ECONNREFUSED 127.0.0.1:6379`), so the hint path could only be exercised through unit tests with a fake subscriber.
- Capacitor `^8.3.1` shell `android/` (`com.khatario.app`, versionCode 4, 1.3.0, minSdk 24, target/compile 36). Plugins: app, bluetooth-le, sqlite, contacts, filesystem, network, preferences, share, plus the native `KhatarioBluetoothSppPlugin`. **No** `@capacitor/push-notifications`, **no** `@capacitor/local-notifications`, **no** `google-services.json`, no Firebase dependency. `build.gradle` only applies the google-services plugin *if* `google-services.json` exists; it does not.
- Flutter app `phone/` (`com.khatario.phone` owner flavor, `com.khatario.staff` staff flavor). `pubspec.yaml` has no `firebase_*`, `flutter_local_notifications` or `workmanager`. The four `firebase-*.properties` entries in the release APK are transitive ML Kit metadata, not Firebase Messaging.
- `web-push ^3.6.7` server side, used only by `lib/platform-push.ts`.
- `@ducanh2912/next-pwa` builds `public/sw.js` from `worker/index.ts` (push + notificationclick handlers whose defaults are "Khatario Admin" / `/admin`). `public/admin/sw.js` is the fallback worker scoped to `/admin`.

## Database (verified on `kh_phase2_test`)

`notifications` columns: `id uuid`, `business_id uuid NOT NULL`, `type varchar NOT NULL`, `title`, `message`, `reference_type`, `reference_id uuid`, `is_read bool`, `created_at timestamp (no tz)`, `read_at`, `user_id uuid NULL` (NULL = broadcast to the business), `seq bigint NOT NULL default nextval('notifications_seq')`, `popup_dismissed_at timestamptz`.

Constraints and indexes: `chk_notification_type` (19 allowed types, migration 326, `NOT VALID` so it is enforced on new rows only), FKs to `businesses` and `users` (cascade), `uq_notifications_seq`, `idx_notifications_business_user_seq (business_id, user_id, seq)` (stream catch-up), `uq_notifications_todo_reminder_user_ref (user_id, reference_id) WHERE type='todo_reminder'` (reminder upsert), plus the older `business_unread`, `business_user`, `user_id`, `reference` indexes. Trigger `trg_notifications_refire_seq` gives a re-fired todo reminder a new `seq` and clears `popup_dismissed_at`.

Other tables: `notification_reads` (migration 337; created but **not used by any code path**, broadcast rows still share one `is_read`), `platform_admin_push_subscriptions` (admin Web Push endpoints), `platform_incidents`, `subscription_notifications` (dedupe log for lifecycle messages), `whatsapp_messages` (reminder send log), `staff_app_devices` (attendance app device **keys**, not push tokens).

There is **no** device-token, FCM-token, delivery-attempt or dead-letter table.

## Code map

### Producers (every `INSERT INTO notifications`, code-level)

No shared `createNotification()` helper exists; 31 call sites write raw SQL. Grouped by `type` (all values are inside the CHECK list; verified by comparing the 31 statements against the live constraint):

| type | reference_type | Where | Recipient (`user_id`) |
| --- | --- | --- | --- |
| `todo_reminder` | `todo` | `lib/services/todoReminderService.ts` (upsert) | assignee and creator (per-user) |
| `invoice_nearing_due`, `invoice_overdue` | `invoice` | `lib/payment-reminder-delivery.ts` | broadcast |
| `invoice_viewed` | `invoices` | `lib/customer-surface/record-view.ts` | broadcast |
| `low_stock_alert` | `item` | `lib/low-stock-checker.ts` | broadcast to supplier business |
| `quantity_request`, `quantity_response` | `quantity_request`, `purchase_order`, `invoice` | `app/api/stock-requests/*`, `app/api/purchase-orders/route.ts`, `app/api/invoices/route.ts` | broadcast |
| `hub_connection_request/accepted/declined` | `supplier_connection_request` | `lib/supplier-hub-links.ts`, `app/api/suppliers/hub/connection-requests/[id]` | broadcast |
| `supplier_approved`, `supplier_rejected` | `supplier` | `app/api/suppliers/[id]/approve` | broadcast |
| `store_enquiry` | `store_enquiry` | `lib/store/notify-merchant.ts` | broadcast |
| `gst_compliance` | `gst_compliance` | `lib/gst/compliance/engine.ts` | broadcast |
| `general` (16 sites) | `supply_order`, `supply_standing_order`, `supplier_hub_money`, `supplier_collection`, `supplier`, `business`, `subscription`, `ai_agent`, `whatsapp_session`, `whatsapp_conversation`, khata (`khata_customer`, `khata_order`), credit approvals (`invoice`/`purchase`), `invoice` (convert-to-purchase) | see grep in Phase 2 | broadcast, except `lib/whatsapp/inbox-ownership.ts` (per-user) |

### Delivery to a signed-in client

1. `GET /api/notifications?limit=20` (`app/api/notifications/route.ts`): session identity only, own rows plus broadcasts, returns `stream_cursor`.
2. `GET /api/notifications/stream` (SSE): `lib/notifications/stream/{hub,connection,catch-up,sse,config}.ts`. One Redis subscriber per process on channel `notifications`; a hint only triggers a PostgreSQL pull for the matching user/business; rows are the only thing sent. Catch-up by `seq` with a 120 s overlap window for out-of-order commits; limits 10 streams per user, 1000 per process; re-authorization every 5 min; heartbeat `: ping` every 25 s.
3. Hints are published by **three** producers only: todo reminders, invoice viewed, inbox ownership. Every other producer relies on the heartbeat poll, which (code-level, `connection.ts:heartbeat`) runs **only while Redis hints are unhealthy**. See Phase 2 finding N-01.
4. Client: `lib/notifications/client/{stream-client,notification-store,lifecycle,primitives,sse-parser}.ts` + `contexts/NotificationContext.tsx` (mounted by `LayoutDataProvider`). Cursor in `localStorage`, cross-tab relay via `BroadcastChannel`, 5-minute poll only while the stream is not open, wake on visibility/online/Capacitor `resume`. Bell: `components/notifications/NotificationCenter.tsx`, `NotificationPanel.tsx`; page `app/(app)/notifications/page.tsx`; todo popups `TodoReminderPopup.tsx` / `MissedRemindersSummary.tsx`.
5. Tap routing: `lib/notifications/notification-href.ts` maps `type`/`reference_type`/`reference_id` to a page (null = not clickable).
6. Read state: `PATCH /api/notifications/[id]/read`, `POST|PATCH /api/notifications/read-all`, `POST /api/notifications/mark-all-read`, `POST /api/notifications/popups/dismiss` (all through `requireNotificationSession`).
7. Flutter phone app: `phone/lib/shell/app_shell.dart` loads `/api/notifications?limit=20` once at shell start for the badge; `screens/notifications/notifications_screen.dart` lists, marks read, and routes a subset of types. No stream, no polling timer, no OS notification.

### Schedulers and workers (code-level, crontab from `docs/SERVER_INFRASTRUCTURE.md`)

| Job | Trigger | Interval | Batch / limits | Idempotency |
| --- | --- | --- | --- | --- |
| Todo reminders | PM2 `todo-reminder-worker` (`lib/workers/todoReminderWorker.ts`): BullMQ delayed job per todo (concurrency 5) + DB sweep every 30 s; `GET /api/cron/send-todo-reminders` (25 s wall, 100/batch, 1000 batches); `GET /api/todos/check-reminders` (signed-in, own business) | 30 s / cron | keyset paging, resume position in memory | `UPDATE todos SET reminder_sent=true ... WHERE reminder_sent=false AND reminder_time<=NOW()` claim inside the same transaction as the notification upsert |
| Payment reminders | `GET /api/cron/send-payment-reminders` every 15 min; per-business 15-minute local window; BullMQ `payment-reminders` worker inside the Next process (concurrency `PAYMENT_REMINDER_CONCURRENCY`, default 4) or inline when Redis is absent (QR sends capped at 50) | 15 min | per-business WhatsApp quota | queue job id `pr-<kind>-<invoiceId>`; `whatsapp_messages` sent log; in-app row deduped by `DATE(created_at)` (check-then-insert) |
| Low stock | `GET /api/cron/check-low-stock` hourly + queued check seconds after a stock change | 1 h | — | `INSERT ... WHERE NOT EXISTS active alert` (no unique index) |
| GST compliance | `GET /api/cron/gst-compliance-alerts` daily | 1 d | — | `gst_compliance_alerts.notified_stage` |
| Subscription lifecycle | `GET /api/cron/check-subscriptions` daily | 1 d | — | `subscription_notifications` `ON CONFLICT DO NOTHING` |
| Supplier Hub WhatsApp | outbox + `GET /api/cron/supplier-hub-whatsapp` every 5 min | 5 min | — | outbox rows |

The staging crontab (QA F-014) has only one job scheduled; none of the above runs on staging until that is fixed. Not re-checked in this audit (no VPS access from here).

### Platform admin Web Push (code-level)

`components/admin/AdminPwaChrome.tsx` asks `Notification.requestPermission()`, fetches `/api/admin/push/vapid` (keys generated once and stored encrypted in `platform_settings`), subscribes the root `/sw.js` (or `/admin/sw.js`), saves to `POST /api/admin/push/subscribe`. `lib/platform-push.ts#sendPlatformAdminPush` sends to every admin endpoint with `urgency: high`, TTL 24 h, deletes endpoints on 404/410, logs other failures. Triggered by `raisePlatformIncident` and sign-ups. `POST /api/admin/push/test` sends a test to all admins. No delivery receipt is stored.

## Dependency map

```
Business event (invoice due, todo due, hub order, low stock, GST, store enquiry, khata, subscription, ...)
  → raw INSERT INTO notifications (31 sites, no helper)                      [exists]
  → PostgreSQL row with seq                                                  [exists, verified]
  → recipient resolution: business_id + optional user_id                     [exists]
  → Redis hint publish                                                       [3 of 31 producers only]  ← gap N-01
  → SSE pull → browser tab / Capacitor WebView / (Flutter: poll on open)      [exists while app is open]
  → device-token lookup                                                      [MISSING: no table]
  → push provider (FCM)                                                      [MISSING: no credentials, no SDK]
  → device receipt                                                           [MISSING]
  → Android display (channel, small icon, sound)                             [MISSING: no channel, no icon, Notification API undefined in WebView (verified)]
  → user tap → destination screen                                            [in-app only: notification-href.ts; several types map to nothing]  ← gap N-02
```

Admin Web Push is a separate, complete chain for operators only: event → `sendPlatformAdminPush` → `web-push` → Chrome service worker `showNotification` → `notificationclick` → `/admin/...`.

## Existing tests (verified, baseline before any change)

- Unit: `npx jest tests/lib/notifications tests/lib/notification-href.test.ts tests/security/notification-routes-auth.test.ts tests/security/notification-popup-dismiss-route.test.ts tests/security/check-reminders-route.test.ts tests/security/customer-send-reminder-route.test.ts tests/lib/todo-reminders tests/lib/payment-reminder-queue.test.ts tests/lib/reminder-schedule.test.ts tests/lib/subscription/lifecycle-notifications.test.ts tests/lib/more-navigation-payment-reminders.test.ts` → **18 suites, 201 tests passed** (10.2 s).
- Database (`PHASE2_TEST_DATABASE_URL` → `kh_phase2_test`, `current_database()` confirmed): `tests/db/notification-access`, `notification-initial-cursor`, `notification-popup-dismiss`, `notification-stream`, `notifications-seq`, `order-notify`, `todo-reminder-sweep` → **7 suites, 62 tests passed** (57.7 s).
- No Android instrumentation tests, no Flutter notification tests, no admin Web Push tests.

## Environment and configuration

- `CRON_SECRET` required by every cron route (`lib/cron-auth.ts`, constant-time compare, fails closed when unset). `/api/cron/` is middleware-public.
- `REDIS_URL` optional; `NOTIFICATION_STREAM_MAX_CONNECTIONS`, `PAYMENT_REMINDER_CONCURRENCY`, `PAYMENT_REMINDER_QUEUE_DISABLED`, `REMINDER_IGNORE_SCHEDULE`, `REMINDER_TEST_MINUTES`.
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` optional (else generated and stored encrypted with `SECRETS_ENCRYPTION_KEY`).
- No `FIREBASE_*`, `GOOGLE_APPLICATION_CREDENTIALS` or FCM server key anywhere in the repository (grep, verified).

## Missing or disconnected links (summary; details and severities in Phases 2 to 4)

1. No FCM/device-token layer for business users (missing feature, not a bug).
2. SSE stream does not deliver un-hinted inserts while Redis is healthy (N-01, backend reliability).
3. Several notification kinds are not tappable (N-02, UX).
4. `notification_reads` exists but broadcast read state is still shared per business (N-03, design gap).
5. Low-stock alert dedupe is not race-safe (N-04).
6. Web `Notification` API, admin Web Push and the inbox toast cannot work inside the Capacitor WebView (N-05, verified on the emulator).
7. Staging crontab (F-014) still has one job: reminders do not run on staging.
