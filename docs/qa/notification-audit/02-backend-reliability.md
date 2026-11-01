# Notification audit, Phase 2: backend generation and correctness

Date: 2026-10-29. Evidence levels: **verified** (executed on `kh_phase2_test` or in Jest), **code-level** (read), **not checked**.

## Per-event trace

| Event | Creates a row when expected? | Title / body / business / recipient / destination | Evidence |
| --- | --- | --- | --- |
| Todo reminder due | Yes. Claim + upsert per recipient in one transaction; re-fire gets a new `seq` and popup. Skipped (not claimed) when the todo was completed, snoozed or re-timed meanwhile. | "Reminder: {title}" / description; `business_id` from the todo; `user_id` assignee and creator; `/tools/todo` | verified: `tests/db/todo-reminder-sweep.db.test.ts`, `notifications-seq.db.test.ts` (62 DB tests pass) |
| Invoice due soon / overdue | Only when the business has `whatsapp_auto_reminders`, the reminder type is enabled, the customer has a phone and the send window is hit. The in-app row is written whether or not the WhatsApp send succeeded. Deduped per invoice per calendar day. | "Invoice {no} due soon" / "{customer}'s invoice for ₹x is due on {d}"; broadcast; `/invoices/{id}` | code-level: `lib/payment-reminder-delivery.ts`; unit `tests/lib/payment-reminder-queue.test.ts` (queue/inline paths) |
| Invoice first viewed by customer | Yes, once (`view_count = 1`), unless `notify_on_first_view` is off. Hint published per member. | "Invoice read" / "Invoice {no} was viewed by {name}"; broadcast; **no destination** (N-02) | verified: `tests/db/notification-access.db.test.ts` (recipients) |
| Low stock at a connected buyer | One active alert per supplier/buyer/item, then one row to the supplier | title includes buyer and item; broadcast to supplier business; `/supply-orders?role=vendor` | code-level: `lib/low-stock-checker.ts` |
| Supplier Hub: order created/confirmed/dispatched/declined, standing order, money notice, collection launch, link ended, connection request/accept/decline | Yes, per business (buyer or vendor side) inside the order transaction, plus the WhatsApp outbox | broadcast; `supply_order` → `/supply-orders/{id}`; money notice, standing order → **no destination** (N-02) | verified for orders: `tests/db/supplier-hub.db.test.ts` (30 pass, run in the Supplier Hub QA on 2026-10-29); others code-level |
| GST compliance finding | On stage change only, unless dismissed at that stage | `/reports/gst/compliance` | code-level: `lib/gst/compliance/engine.ts` |
| Store enquiry, khata request/approval | Yes; failures logged, never thrown | `/settings/online-store/enquiries`, `/customers/{id}` | code-level |
| Subscription lifecycle (trial ending, ended, payment failed) | Yes when at least one channel delivered; dedupe via `subscription_notifications` | broadcast; `reference_type='subscription'` → **no destination** (N-02) | unit: `tests/lib/subscription/lifecycle-notifications.test.ts` |
| WhatsApp inbox assignment, AI agent billing | Yes | inbox: per-user, `/whatsapp/conversations?c=`; billing: `ai_agent` → **no destination** | code-level |
| Credit approval request/approve/reject, stock requests, purchase order from a quantity request, supplier approve/reject | Yes | broadcast; quantity requests → **no destination** (no page) | code-level |

Business isolation: every producer resolves the recipient business from server-side rows (linked supplier, order side, todo, invoice), never from the request body. Read side: `requireNotificationSession` (session user + session business, `user_businesses` membership) on every notification route; `GET /api/notifications` uses `requireTenantBusinessId`. **Verified** by `tests/security/notification-routes-auth.test.ts` and `tests/db/notification-access.db.test.ts` (cross-business and other-user rows are not returned, mark-all is scoped).

Type values: all 31 inserts use a `type` that is inside the live `chk_notification_type` list on `kh_phase2_test` (verified by comparing the constraint dump with the grep of every `VALUES (...)` clause). No insert can fail on the CHECK.

## Findings

### N-01 (Medium) Live delivery depends on a Redis hint that 28 of 31 producers never send

`lib/notifications/stream/connection.ts`:

```ts
private heartbeat(): void {
  if (!this.write(formatComment('ping'))) return;
  if (this.phase === 'live' && !this.opts.host.hintsHealthy()) void this.pull();
}
```

While the Redis subscriber and publisher are both ready, a stream only pulls when a hint arrives for that user or business. Only `todoReminderService.ts`, `customer-surface/record-view.ts` and `whatsapp/inbox-ownership.ts` publish hints. Payment reminders, Supplier Hub orders, low stock, GST, store enquiries, khata, subscription and every other producer insert the row and stop. On a server with Redis healthy (staging and production both set `REDIS_URL`), those rows are not delivered to an open tab until the user opens the bell (panel refresh), changes tab visibility (wake), the 5-minute reauth closes nothing, or the stream reconnects. The client's 5-minute poll runs **only while the stream is not open** (`stream-client.ts#poll`). So the bell count can stay stale for as long as the tab stays open and focused.

Evidence: **verified** by a new unit test (Phase 6, `tests/lib/notifications/stream/hub.test.ts` "delivers rows inserted without a hint ...") which failed before the fix and passes after. Existing tests only covered polling while Redis is down.

Remediation (Phase 7): the heartbeat always pulls when live. Cost: two indexed queries per open stream per 25 s (floor-based `fetchAfter`), at most ~80 queries/s at the 1000-stream process limit. Hints still give sub-second delivery for the three producers that send them.

### N-02 (Low) Several notification kinds open nothing when tapped

`notification-href.ts` returns null for `invoice_viewed` (`reference_type='invoices'`, plural, not `invoice`), `supplier_hub_money`, `supply_standing_order`, `purchase_order`, `subscription`, `ai_agent`, `whatsapp_session`, `quantity_request`. The bell renders them without a button role. Remediated in Phase 7 for the kinds that have a page; `quantity_request` has no page and stays null (documented).

### N-03 (Low, design) Broadcast rows share one read flag per business

`notification_reads` (migration 337) is never written or read. `markNotificationRead` and `markAllNotificationsRead` update `is_read` on broadcast rows (`user_id IS NULL`), so one user marking a reminder read clears it for every colleague. Documented in `lib/notifications/read-state.ts`. Not changed: it needs a product decision and a backfill plan.

### N-04 (Low) Low-stock alert dedupe is check-then-insert

`low_stock_alerts` has no unique index on `(supplier_business_id, customer_business_id, item_id) WHERE alert_status='active'`. `raiseAlerts` uses `INSERT ... WHERE NOT EXISTS`, which is safe for sequential runs but two overlapping runs (the queued check seconds after a stock change and the hourly cron) can both insert, producing two alerts and two supplier notifications. Not fixed here: the index migration can fail on existing duplicates in staging/production and needs a data check first (manual action in the final report).

### N-05 (Low) Payment-reminder in-app row dedupe is check-then-insert

`createInvoiceNotification` selects then inserts per `DATE(created_at)`. The BullMQ worker runs up to 4 jobs concurrently, but job ids are unique per invoice and kind and the cron only enqueues invoices that are not already waiting, so the same invoice is not processed twice in parallel in practice. Risk accepted; documented.

### N-06 (Info) Creation and delivery are separate, but delivery is never recorded

A row in `notifications` proves creation only. SSE delivery is not acknowledged; the client cursor in `localStorage` is the only state. The Flutter app reads the list on open. There is no per-device delivery record, so "was it shown on the phone" cannot be answered from the database. This is inherent to the current design and would be solved by the FCM work listed in the final report.

### N-07 (Info) Logging

Todo reminders log structured JSON (`logTodoReminder`, `reminderPipelineLog`: todo id, business id, job id, reason, never message text or phone). Payment reminders log business and invoice ids. Stream errors are swallowed per connection (`catch {}` → `reconnect` event) with no server-side log line; a persistent catch-up failure would be invisible in PM2 logs. Not changed (adding logs is a judgement call for the owner); noted as a remaining risk.

## Scheduler checks (code-level, confirmed by existing tests where noted)

| Check | Result |
| --- | --- |
| Overlap creates duplicates? | Todo: no, atomic claim (verified `todo-reminder-sweep.db.test.ts` runs two sweeps and BullMQ jobs together). Payment: no, queue id + sent log (unit tests). Low stock: possible under overlap (N-04). GST: no (`notified_stage`). |
| Multiple workers on one notification? | Todo: claim is `UPDATE ... WHERE reminder_sent=false`, so the loser gets `not_claimed`. Payment worker: BullMQ lock per job. |
| Lost between persistence and delivery? | Todo: the Redis publish is fire-and-forget after commit; if Redis is down the row still exists and the heartbeat poll (Redis down) or the fix for N-01 (Redis up) delivers it. |
| Pagination / batch / timeout leaving rows unsent? | Todo sweep: keyset paging, resume position in memory, wraps around, 25 s wall per cron call, 100 per batch, 1000 batches. A restart loses the position (restarts from the oldest due row; delays but never drops). Payment: per-business quota; invoices beyond the quota are skipped and retried next window. |
| Concurrency limits | Todo worker 5, payment worker 4 (env), stream 10/user and 1000/process. |
| Read vs delivered | Separate concepts in the schema (`is_read`, `popup_dismissed_at`, cursor) but delivery is not persisted (N-06). |
| Invalid, expired or deleted recipients | Todo: a deleted recipient (FK 23503 on `notifications_user_id_fkey`) is skipped inside a savepoint; the claim is kept. Admin Web Push: 404/410 endpoints deleted. There are no device tokens to expire. |
| Indexes used by the sweep and catch-up | `idx_todos_reminder_sweep (reminder_time) WHERE reminder_sent=false AND status IN (...)` and `idx_notifications_business_user_seq` exist on `kh_phase2_test` (verified). |

## What was not checked

- The staging or production crontab, PM2 process list and Redis health (no VPS access from this session; F-014 says staging has one cron job).
- Real WhatsApp or email sends (not allowed during testing; the unit tests mock the transports).
- `lib/khata`, `lib/store`, credit approvals and stock requests were read, not executed.
