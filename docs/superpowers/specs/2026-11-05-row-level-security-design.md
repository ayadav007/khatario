# Row Level Security (RLS) for Khatario: design

Status: designed 2026-11-05 from the repository at commit 8240679 and the live audit of both databases (`database/scripts/check-rls.sql`: 0 of 477 tables have RLS on staging `khatario` and production `khatario_prod`). Not built. Implementation plan: [docs/superpowers/plans/2026-11-05-row-level-security.md](../plans/2026-11-05-row-level-security.md).

## 1. Why, and what RLS adds

Today every tenant boundary is enforced in application code: `middleware.ts` verifies the JWT and sets the trusted headers `x-authenticated-user-id` and `x-authenticated-business-id`; routes read them through `lib/auth-helpers.ts` (`requireTenantBusinessId`, `getSessionScopedBusinessId`, `getBusinessIdFromRequest`) and the guards built on them; every SQL statement must then filter by `business_id` itself. The app role `khatario_user` holds full privileges on every table (`database/scripts/grant-app-user-migrations.sql`), so one missing `WHERE business_id = $1` (the repo's own audits in `MISSING_USERID_AUDIT_REPORT.md` and `SECURITY_AUDIT_REPORT.md` record such gaps) exposes another business's rows.

RLS makes Postgres apply the tenant filter to every statement the app role runs, whatever the SQL says. It is a second layer, not a replacement: the code keeps its filters and PBAC, and RLS catches what the code misses.

**Decisions that shape everything below**

| Decision | Choice | Why |
| --- | --- | --- |
| How a connection learns the tenant | Two session settings, `khatario.business_id` and `khatario.user_id`, read by the SQL functions `khatario_business_id()` and `khatario_user_id()` | Same mechanism as the existing ledger delete guard (`lib/accounting/ledger-delete-guard.ts`, migration 323). Policies stay one line. |
| Who bypasses | A second login role `khatario_system` with `BYPASSRLS`, member of `khatario_user` | Postgres's supported bypass. No "magic setting" an injected query could flip. The `postgres` superuser (migrations, backups) bypasses by nature. |
| Where the tenant is set | On every pool checkout in `lib/db.ts`, from an `AsyncLocalStorage` context, falling back to the middleware headers via `next/headers` | 1,072 route files and 1,079 files import `lib/db`; 226 open their own client with `getPool().connect()`. Only a choke point in the pool covers them all without touching each file. |
| Policies for child tables | `EXISTS` against the parent's `business_id` | No data migration, instant rollback. Denormalising `business_id` into hot child tables is a later optimisation. |
| Policy audience | No `TO` clause (applies to every role without `BYPASSRLS`) | Portable to the test database, where the app role does not exist; tests use `SET ROLE`. |
| `FORCE ROW LEVEL SECURITY` | On every protected table | Tables are owned by `postgres` because migrations run through `MIGRATION_DATABASE_URL`, but `grant-app-user-migrations.sql` lets `khatario_user` create tables too; FORCE closes the owner exemption either way. |
| Missing context | Fail closed | A statement with no tenant set sees no rows and cannot write. The app detects this before the database does (see §5.4) so the gap shows up in staging logs, not as silent empty screens. |

## 2. Table inventory

Parsed from `database/schema.sql` plus the 490 files in `database/migrations/` (473 tables found; the live databases have 477, so the first implementation task reconciles against `pg_tables` and the coverage check fails the build for any table not classified). Every table falls into exactly one class. The authoritative list is `database/rls/manifest.json`, built by the plan's Task 1; this section states the rules and names the members found so far.

### 2.1 Class T: direct tenant tables (319 tables)

Have a `business_id` column referencing `businesses(id)`.

- **T-strict (221):** `business_id NOT NULL`. Examples: `invoices`, `items`, `customers`, `payments`, `branches`, `warehouses`, `whatsapp_conversations`, `store_orders`, `notifications`, `tasks`, `leads`, `gst_filings`, `journal_entries`, `attendance_sites`, `employee_exits`, `stock_counts`, `kb_conversations`, `push_jobs`.
- **T-nullable (98):** `business_id` without a `NOT NULL` found in the SQL: `account_groups, accounts, activity_logs, advance_payments, bank_accounts, bank_statements, budgets, business_locations, business_settings, business_subscriptions, categories, credit_notes, currencies, customers, debit_notes, delivery_challans, employees, estimates, exchange_rates, expense_categories, expenses, financial_years, fixed_assets, holidays, invoice_attachments, invoice_template_settings, invoice_templates, invoices, items, kb_chunks, kb_documents, kb_sources, label_templates, leave_types, ledger_entries, ledger_entry_lines, ledger_entry_deletions, opening_balances, payments, payslips, purchase_orders, purchase_returns, purchases, push_devices, recurring_invoices, salary_*, sales_orders, shifts, stock_movements, stock_transfers, subscription_usage, suppliers, tasks, tax_*, tcs_*, tds_*, user_activity_logs, user_roles, users, whatsapp_config, whatsapp_inbound_events, whatsapp_keywords, whatsapp_messages, whatsapp_reminder_settings, whatsapp_sessions, work_orders, year_closing_entries` and the rest listed in the manifest. The implementation first counts `NULL` rows per table on staging. Two outcomes:
  - **Orphans** (NULL by accident): backfill or delete before enabling, then `SET NOT NULL` where the code never writes NULL. These become T-strict.
  - **System defaults** (NULL means "platform-provided row visible to everyone"): the code confirms only `invoice_templates` (`is_system = TRUE`, comment in the migration), `tds_categories` and `assistant_leads` treat NULL this way. These become **T-shared**: read allows `business_id IS NULL OR business_id = khatario_business_id()`, writes allow only the tenant's own rows (system rows are edited by platform admins through the system role).
- **Identity tables** (special policies, §3.4): `users`, `businesses`, `user_businesses`.

### 2.2 Class C: child tables (about 90 tables)

No `business_id`; the tenant is the parent's. The manifest records `parent_table` and `fk_column`. Groups found:

| Parent | Children |
| --- | --- |
| `employees` (`employee_id`) | `attendance_logs, attendance_otps, attendance_sessions, employee_attendance, employee_attendance_sites, employee_documents, employee_expenses, employee_face_data, employee_performance, employee_targets, leave_balances, leave_requests, commission_earnings, expense_comments, leave_request_comments` |
| `employee_expenses` (`expense_id`) | `expense_approvals, expense_attachments` |
| `employee_exits` | `hr_exit_tasks` |
| `invoices` | `invoice_items, proforma_lifecycle_timeline` |
| `purchases` / `purchase_orders` / `purchase_returns` | `purchase_items` / `purchase_order_items` / `purchase_return_items` |
| `sales_orders`, `estimates`, `credit_notes`, `debit_notes`, `delivery_challans`, `work_orders`, `stock_transfers`, `stock_counts`, `production_entries`, `boms`, `order_returns`, `recurring_invoices`, `eway_bills`, `gst_filings`, `gstr1_filings`, `journal_entries`, `insurance_claims`, `salary_advances`, `salary_structures`, `ot_policies`, `leave_plans`, `hr_engagement_polls`, `order_lists`, `workflows`, `tasks`, `suppliers`, `store_orders`, `store_customers`, `store_branch_delivery`, `push_jobs`, `kb_conversations`, `whatsapp_bot_rules`, `whatsapp_broadcasts`, `whatsapp_campaigns`, `whatsapp_contact_groups`, `whatsapp_conversations`, `branches`, `attendance_sites`, `user_roles`, `notifications`, `staff_app_devices`, `closing_stock_snapshot_headers`, `ledger_entry_lines` | the matching `*_items`, `*_lines`, `*_history`, `*_vehicles`, `*_documents`, `*_invoices`, `*_attachments`, `*_adjustments`, `*_recoveries`, `*_rules`, `*_restrictions`, `*_types`, `*_options`, `*_sends`, `*_executions`, `*_comments`, `*_aliases`, `store_order_items`, `store_coupon_redemptions`, `store_customer_addresses`, `store_delivery_charges`, `push_deliveries`, `kb_messages`, `whatsapp_bot_rule_chains`, `whatsapp_broadcast_recipients`, `whatsapp_campaign_recipients`, `whatsapp_campaign_settings`, `whatsapp_contact_group_members`, `whatsapp_conversation_label_assignments`, `branch_document_counters`, `branch_document_prefixes`, `branch_warehouses`, `attendance_site_wifi`, `field_permissions`, `role_permissions`, `notification_reads`, `staff_app_challenges`, `closing_stock_snapshot_items`, `stock_audit_entries`, `ledger_entry_history` |
| `items` (`item_id` or `bundle_id`) | `item_variants, bundle_items, location_stock` |
| `users` (`user_id`) | `user_branches, user_warehouses` |
| two hops | `kb_feedback` (→ `kb_messages` → `kb_conversations`), `hr_engagement_poll_votes` (→ `hr_engagement_polls`), `task_comments` and `task_attachments` (→ `tasks`) |

Rule for a child with several candidate parents (`location_stock` has `item_id`, `location_id`, `warehouse_id`): use the parent that is `NOT NULL`, preferring the one the code's own queries join on.

### 2.3 Class M: multi-party tenant tables (14 tables)

Two businesses legitimately read the same row (the supplier hub). Columns are `buyer_business_id` / `vendor_business_id` or `supplier_business_id` / `customer_business_id` or `requester_business_id` / `responder_business_id`:

`low_stock_alerts, quantity_requests, supplier_bill_receipts, supplier_buyer_prices, supplier_connection_requests, supplier_hub_money_notices, supplier_invite_orders, supplier_item_links, supplier_item_thresholds, supplier_published_listings, supply_orders, supply_standing_orders, supplier_collections`, and their children `supplier_bill_receipt_lines, supplier_invite_order_lines, supply_order_lines, supply_standing_order_lines` (class C with an M parent).

`supplier_published_listings` is the marketplace: any tenant may read a published listing; only the supplier writes it.

### 2.4 Class G: global catalog (RLS off, readable by every tenant)

No tenant, read by tenant code, contain nothing private: `subscription_plans, subscription_plan_features, subscription_plan_limits, platform_features, platform_limits, coupons, feature_flags, permission_modules, report_definitions, hsn_sac_master, hsn_ai_suggestions, gst_rcm_rules, invoice_layout_profiles, known_layout_profiles, invoice_vendor_profiles, invoice_field_learning, booking_time_slots, blog_categories, blog_media, blog_post_tags, blog_posts, blog_slug_redirects, blog_tags, marketing_pages, marketing_page_versions, platform_promotions, schema_migrations`.

Writes to these come from platform admins (system role) or migrations. They are listed explicitly so the coverage check can tell "left off on purpose" from "forgotten".

### 2.5 Class P: platform-private (RLS on, no tenant policy)

Only the system role may touch them; the app role gets nothing: `platform_admins, platform_admin_logs, platform_admin_push_subscriptions, platform_settings, platform_incidents, platform_public_otps, platform_whatsapp_templates, platform_whatsapp_sends, platform_partners, platform_partner_users, platform_partner_sessions, partner_payouts, partner_payout_items, partner_program_settings, partner_sales_kit_items, partner_deals, marketing_ads, marketing_posts, meta_ad_mappings, sales_flow_media, sales_flow_versions, demo_bookings, booking_activities, assistant_settings, assistant_leads, lead_events, lead_followups, platform_email_logs, platform_billing_webhook_events`.

Tenant code that reads these today (7 files read `platform_settings`, 12 read templates, promotions or partners outside `app/api/admin`) moves behind small system-role accessors (§4.5).

### 2.6 Views and functions

- Views `order_hub`, `v_business_coa_readiness`, `v_phase3_gst_readiness`, `v_phase4_inventory_readiness` are owned by `postgres`, so a query through them would bypass RLS. They get `security_invoker = true` (Postgres 15+; the rollout verifies `SHOW server_version` and the infrastructure notes point at Postgres 16).
- The 81 SQL functions have no `SECURITY DEFINER`, so they and every trigger run as the caller and stay inside RLS. Triggers that write a second business's rows (supplier hub alerts) are covered by the class M policy because the acting tenant is one of the two parties.

## 3. Policy definitions

All policies are generated from the manifest by `scripts/rls/generate-policies.js` into one migration so that the SQL and the manifest cannot drift. Helper functions, in migration 467:

```sql
CREATE OR REPLACE FUNCTION khatario_business_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE AS
  $$ SELECT NULLIF(current_setting('khatario.business_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION khatario_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE AS
  $$ SELECT NULLIF(current_setting('khatario.user_id', true), '')::uuid $$;
```

With no setting, both return NULL, every comparison below is NULL, and the row is invisible and unwritable.

### 3.1 Class T-strict

```sql
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON invoices;
CREATE POLICY tenant_isolation ON invoices
  USING (business_id = khatario_business_id())
  WITH CHECK (business_id = khatario_business_id());
```

### 3.2 Class T-shared

```sql
CREATE POLICY tenant_read ON invoice_templates FOR SELECT
  USING (business_id IS NULL OR business_id = khatario_business_id());
CREATE POLICY tenant_write ON invoice_templates FOR INSERT
  WITH CHECK (business_id = khatario_business_id());
CREATE POLICY tenant_update ON invoice_templates FOR UPDATE
  USING (business_id = khatario_business_id())
  WITH CHECK (business_id = khatario_business_id());
CREATE POLICY tenant_delete ON invoice_templates FOR DELETE
  USING (business_id = khatario_business_id());
```

### 3.3 Class C

```sql
CREATE POLICY tenant_isolation ON invoice_items
  USING (EXISTS (SELECT 1 FROM invoices p
                 WHERE p.id = invoice_items.invoice_id
                   AND p.business_id = khatario_business_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM invoices p
                      WHERE p.id = invoice_items.invoice_id
                        AND p.business_id = khatario_business_id()));
```

Two-hop children nest the same shape through the intermediate table. The parent lookup is by primary key, so the cost is one index probe per row. Children of class M parents use the parent's M predicate.

### 3.4 Identity tables

```sql
-- users: own business, members of the active business, and always the acting user's own row
CREATE POLICY tenant_isolation ON users
  USING (business_id = khatario_business_id()
         OR id = khatario_user_id()
         OR EXISTS (SELECT 1 FROM user_businesses ub
                    WHERE ub.user_id = users.id AND ub.business_id = khatario_business_id()))
  WITH CHECK (business_id = khatario_business_id());

-- businesses: the active business, every business the acting user belongs to,
-- and the other party of an accepted supplier connection
CREATE POLICY tenant_read ON businesses FOR SELECT
  USING (id = khatario_business_id()
         OR EXISTS (SELECT 1 FROM user_businesses ub
                    WHERE ub.business_id = businesses.id AND ub.user_id = khatario_user_id())
         OR EXISTS (SELECT 1 FROM supplier_connection_requests r
                    WHERE r.status = 'accepted'
                      AND khatario_business_id() IN (r.buyer_business_id, r.supplier_business_id)
                      AND businesses.id IN (r.buyer_business_id, r.supplier_business_id)));
CREATE POLICY tenant_write ON businesses FOR UPDATE
  USING (id = khatario_business_id()) WITH CHECK (id = khatario_business_id());
-- INSERT and DELETE of businesses: system role only (signup, tenant purge)

CREATE POLICY tenant_isolation ON user_businesses
  USING (business_id = khatario_business_id() OR user_id = khatario_user_id())
  WITH CHECK (business_id = khatario_business_id());
```

The `status = 'accepted'` column name is confirmed in Task 1 against `supplier_connection_requests`; the supplier hub database tests are the check that the policy is wide enough.

### 3.5 Class M

```sql
CREATE POLICY tenant_isolation ON supply_orders
  USING (khatario_business_id() IN (buyer_business_id, vendor_business_id))
  WITH CHECK (khatario_business_id() IN (buyer_business_id, vendor_business_id));

CREATE POLICY tenant_read ON supplier_published_listings FOR SELECT
  USING (khatario_business_id() IS NOT NULL);
CREATE POLICY tenant_write ON supplier_published_listings
  FOR ALL USING (supplier_business_id = khatario_business_id())
  WITH CHECK (supplier_business_id = khatario_business_id());
```

### 3.6 Class P

`ENABLE` and `FORCE` with no policy. Postgres's default for a table with RLS on and no matching policy is deny, which is the intent.

### 3.7 Class G

Untouched. Listed in the manifest as `global` so the coverage check accepts them.

### 3.8 Indexes

Every class T table needs an index whose first column is `business_id`, or the policy turns each scan into a sequential scan filtered on the setting. Task 1's audit query lists T tables without one; the migration adds `CREATE INDEX CONCURRENTLY` for each (outside the transaction, in its own script, because `CONCURRENTLY` cannot run inside the migration runner's transaction).

## 4. Application changes

### 4.1 Tenant context (`lib/tenant-context.ts`, new)

```ts
export type TenantContext =
  | { mode: 'tenant'; businessId: string | null; userId: string | null; source: 'explicit' | 'header' | 'none' }
  | { mode: 'system'; reason: string };

export function runWithTenant<T>(businessId: string, fn: () => Promise<T>, opts?: { userId?: string }): Promise<T>;
export function runAsSystem<T>(reason: string, fn: () => Promise<T>): Promise<T>;
export function enterTenant(businessId: string, userId?: string | null): void;   // AsyncLocalStorage.enterWith, for guards that cannot wrap the handler
export function currentTenant(): TenantContext;
```

`currentTenant()` resolves in this order:

1. The `AsyncLocalStorage` store, if `runWithTenant`, `runAsSystem` or `enterTenant` set one.
2. The request headers from `next/headers` (guarded `require`, so worker and script processes get `null`): `x-authenticated-business-id` and `x-authenticated-user-id` give a tenant context; `x-platform-admin-id` with no business header gives a system context with reason `platform-admin`. These headers are trustworthy because `middleware.ts` strips any client-sent copy before setting its own (its `TRUSTED_IDENTITY_HEADERS` list, line 44 onward).
3. Otherwise `{ mode: 'tenant', businessId: null, userId: null, source: 'none' }`: fail closed.

Platform-admin impersonation (`createImpersonationToken` in `lib/admin-business-ops.ts`) issues a normal business JWT, so an impersonating admin runs as that tenant. Correct.

### 4.2 The pool (`lib/db.ts`)

`getPool()` returns a `TenantPool` that wraps `pg.Pool`. Behaviour:

- `connect()`: checks out a client, computes the context key (`tenant:<business>:<user>` or `system`), and if the client's cached key differs, runs
  `SELECT set_config('khatario.business_id', $1, false), set_config('khatario.user_id', $2, false)` and caches the key in a `WeakMap<PoolClient, string>`. A failed `set_config` releases the client with the error (which destroys it) and rethrows.
- `query(text, params)`: `connect()`, run, `release()`. Same path as before, so the 1,079 importers and the 226 own-client call sites change nothing.
- Under `mode: 'system'`, `getPool()` returns the second pool for `khatario_system`, and `query()` goes there. Its clients never run `set_config`.
- No reset on release. The next checkout re-asserts whatever the next context is, so a stale value on an idle client can never leak. A client held across a context change keeps the context it was checked out under; nested `runWithTenant` inside an open client is unsupported and documented.

Configuration (env.example, `ENV_VARIABLES_GUIDE.md`):

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` or `DB_*` | unchanged: the app role `khatario_user` |
| `DATABASE_SYSTEM_URL` or `DB_SYSTEM_USER` + `DB_SYSTEM_PASSWORD` | the `khatario_system` role; same host, port and database |
| `DB_POOL_MAX` (default 40), `DB_SYSTEM_POOL_MAX` (default 10) | replaces the hard-coded 50 |
| `RLS_CONTEXT_MODE` = `off` / `warn` / `enforce` | §5.4 |

### 4.3 Routes

- **Business-user routes (the 1,072 route files, including the 448 that use `lib/security`, `lib/stock-request-security`, `lib/fulfilment/hub-scope` and the other guards):** no change. The headers are present, resolution step 2 applies.
- **Platform admin routes (101 under `app/api/admin`, 94 using `requirePlatformRequest`):** no change; step 2 maps the admin header to system mode.
- **Pre-authentication routes** run explicitly under `runAsSystem('auth')`: `app/api/auth/login`, `refresh`, `forgot-password`, `reset-password`, `impersonate`, `session`; signup (`app/api/businesses` add-business route); `app/api/public/platform-otp`; `app/api/partners/auth/*`. They read `users`, `businesses` and `employees` before any tenant is known.
- **`app/api/businesses/switch` and `my`:** stay in tenant mode; the identity policies in §3.4 expose the acting user's memberships through `khatario_user_id()`.
- **Employee portal:** `lib/employee-portal/portal-api-guard.ts` resolves the session from the database when the request carries the portal cookie rather than JWT headers. The session lookup runs under `runAsSystem('employee-portal-session')`; once `businessId` is known the guard calls `enterTenant(businessId, userId)`.
- **Candidate portal (`lib/hr/recruitment/candidate-portal-session.ts`), store customers (`lib/store/customer-session.ts`), riders, the invoice share links under `app/api/public/i`, `wa-shop`, `wa-widget`, `supplier-order`, `portal`:** the token or cookie lookup runs as system, then `enterTenant(business_id)`.
- **Storefront (`app/api/public/store/[subdomain]/*`, 23 routes, and the server-rendered store pages):** `resolveStoreBySubdomain` in `lib/store/resolve-store.ts` reads `businesses`, `branches`, `store_delivery_charges` before the tenant is known, so it runs under `runAsSystem('store-resolve')`. A new `withStoreTenant(request, params, handler)` in `lib/store/engine/route-utils.ts` resolves the store, then runs the handler under `runWithTenant(store.businessId)`. Each storefront route adopts it.
- **Webhooks (`app/api/webhooks/leads`, `meta-whatsapp`, `platform-billing`, `store`):** verify the signature, look up the owning business as system, then `runWithTenant`. Platform billing events stay in system mode (class P table).
- **Cron routes (34 files using `assertCronAuthorized`, 20 of them under `app/api/cron`):** the business enumeration query runs under `runAsSystem('cron-enumerate')`; the per-business body runs under `runWithTenant(row.business_id)`. Each route already loops over businesses (see `send-payment-reminders`), so the change is the two wrappers.

### 4.4 Background jobs and long-running processes

| Process | Where the tenant comes from | Change |
| --- | --- | --- |
| Payment reminder worker, started inside the server by `ensurePaymentReminderWorker()` (`lib/queue/paymentReminderQueue.ts`) | job data already carries `businessId` | processor body in `runWithTenant(job.data.businessId)` |
| Todo reminder worker (`lib/workers/todoReminderWorker.ts`, `lib/queue/todoReminderQueue.ts`, `syncTodoReminderJob.ts`) | job must carry `businessId`; the enqueue side adds it | processor refuses a job without `businessId` and runs the rest under `runWithTenant` |
| Knowledge-base index worker (`lib/workers/kbIndexWorker.ts`) | `target: 'tenant'` jobs carry `businessId`; the nightly job enumerates tenants | enumeration as system; each `reindex` under `runWithTenant`; `target: 'global'` as system |
| WhatsApp Baileys worker (`scripts/whatsapp-worker.ts`, `lib/baileys-hybrid.ts`, `lib/whatsapp.ts`) | one socket per business, created from the `whatsapp_sessions` rows | the session list as system; every socket event handler registered inside `runWithTenant(businessId)` so inbound messages, reconnects and QR updates write as that tenant |
| WhatsApp message worker (`scripts/whatsapp-message-worker.ts`) | job data | same as the reminder worker |
| Marketing worker (`workers/marketing`) | platform content | `runAsSystem('marketing')` |
| Notification SSE stream (holds a dedicated client for `LISTEN`) | request headers | the client is checked out inside the request, so it carries the tenant; nothing to change, verified by `tests/db/notification-stream.db.test.ts` |
| Maintenance scripts in `scripts/*.js` | their own `pg.Pool` as `postgres` through `scripts/db-config.js` | none; superuser bypasses. They must never be pointed at `khatario_user`. |
| Tenant purge (`purgeTenantRows`, `deleteBusinessCompletely` in `lib/admin-business-ops.ts`) | platform admin | runs under the platform-admin system context already (step 2) |
| Backups | `pg_dump` as `postgres` on the VPS | **Must stay on a bypass role.** A dump taken as `khatario_user` after RLS is enabled would contain zero tenant rows and no error. The runbook adds a row-count check to the backup step. |

Worker processes build their own pool from the same `lib/db.ts`, so each PM2 worker gets both pools. `DB_POOL_MAX=10` and `DB_SYSTEM_POOL_MAX=3` in the worker entries of the PM2 config keep the total under Postgres's `max_connections` (verified in the rollout, two environments share one server).

### 4.5 Tenant code that reads platform-private tables

The 19 files outside `app/api/admin` that read `platform_settings`, `platform_whatsapp_templates`, `platform_promotions` or `platform_partners` (Razorpay keys for subscription checkout, VAPID keys for push, the platform WhatsApp sender, partner attribution) move those reads behind accessors in `lib/platform/*.ts` that wrap `runAsSystem('platform-read:<table>')`. They return only the fields the caller needs; encrypted secrets stay inside the accessor.

## 5. Connection pool and transaction handling

### 5.1 Why session-level settings are safe here

`set_config(..., false)` is session scoped, and the app talks to Postgres directly from `pg.Pool` (no PgBouncer; `max_connections` is the only limit). A client therefore belongs to one tenant from checkout to release, which is exactly the lifetime of a transaction opened with `BEGIN` on that client. If PgBouncer in transaction-pooling mode is ever introduced, this must change to `SET LOCAL` inside a transaction per statement; the design note in `lib/db.ts` says so.

### 5.2 Transactions

The 187 files that run `BEGIN` do it on a client from `getPool().connect()`. That client was set to the tenant at checkout, so every statement in the transaction, including trigger side effects, runs as that tenant. A statement that touches another tenant's rows inside the transaction fails with `42501` and the existing `ROLLBACK` handling aborts the whole unit; there is no partial commit path that RLS adds.

The ledger delete guard already uses transaction-local settings (`set_config(..., true)`) on the same client. The two settings families do not interact.

### 5.3 Pool sizing

| Pool | Today | After |
| --- | --- | --- |
| App role, web process | 50 | `DB_POOL_MAX` 40 |
| System role, web process | none | `DB_SYSTEM_POOL_MAX` 10 |
| Each worker process | 50 | 10 + 3 |

The rollout records `SHOW max_connections` and the sum across staging and production processes before enabling.

### 5.4 Fail-closed detection in the app (`RLS_CONTEXT_MODE`)

The generated file `lib/db/rls-tables.generated.ts` lists every class T, C, M and P table. In `TenantPool.query` and `connect`, when the context is `source: 'none'` and the statement names one of those tables (regex on the SQL text; cheap, cached per statement string):

- `off`: do nothing (today's behaviour).
- `warn`: log once per distinct stack `[rls-context] no tenant context for <table> at <route or caller>` and continue.
- `enforce`: throw `TenantContextMissingError` before the statement reaches Postgres.

This is how staging proves context coverage before the database enforces anything (§7). Global tables never trigger it.

## 6. Cross-tenant security tests

### 6.1 Unit tests (`tests/lib/tenant-context.test.ts`, `tests/lib/db-tenant-pool.test.ts`)

- resolution precedence: explicit context beats headers; headers beat none; platform-admin header yields system mode; no headers outside a request yields `source: 'none'`.
- `connect()` issues `set_config` on first use of a client, skips it when the same context reuses the client, re-issues it when a different tenant gets the client, and destroys the client when `set_config` fails.
- `runAsSystem` routes `getPool()` and `query()` to the system pool.
- `RLS_CONTEXT_MODE=enforce` throws for `SELECT * FROM invoices` with no context and allows `SELECT * FROM subscription_plans`.

### 6.2 Database tests on `kh_phase2_test` (`tests/db/rls-isolation.db.test.ts`, `tests/db/rls-coverage.db.test.ts`, opt-in `RLS_DB_TEST=1`)

The suite connects as `postgres` (superuser, bypasses RLS), so each test does `SET ROLE kh_rls_app`, a `NOLOGIN` role created by the fixture with the same grants as `khatario_user`. The fixture seeds business A and business B with one row per class: an invoice and an invoice item (T-strict, C), a template (T-shared, plus one system template with NULL), a supply order where A is buyer and B is vendor (M), a user in each business plus one user who belongs to both (identity).

| Case | As A (tenant context) | Expected |
| --- | --- | --- |
| read own | `SELECT count(*) FROM invoices` | 1 |
| read other | `SELECT * FROM invoices WHERE id = $B_invoice` | 0 rows |
| update other | `UPDATE invoices SET notes = 'x' WHERE id = $B_invoice` | 0 rows affected |
| insert for other | `INSERT INTO invoices (business_id, ...) VALUES ($B, ...)` | error `42501` |
| child of other | `INSERT INTO invoice_items (invoice_id, ...) VALUES ($B_invoice, ...)` | error `42501` |
| child read via join without filter | `SELECT count(*) FROM invoice_items` | A's items only |
| shared template | `SELECT count(*) FROM invoice_templates` | own + system; `UPDATE` of the system row affects 0 |
| multi-party | `SELECT count(*) FROM supply_orders` as A and as B | 1 each; as C, 0 |
| identity | `SELECT count(*) FROM users` as A | A's users + the dual-membership user |
| platform-private | `SELECT * FROM platform_settings` | 0 rows; as `postgres` or `kh_rls_system`, 1 row |
| no context | `RESET khatario.business_id; SELECT count(*) FROM invoices` | 0; `INSERT` fails `42501` |
| system role | `SET ROLE kh_rls_system; SELECT count(*) FROM invoices` | 2 |
| view | `SELECT count(*) FROM order_hub` as A | A's orders only |

`rls-coverage.db.test.ts` reads `pg_tables`, `pg_class.relrowsecurity`, `relforcerowsecurity`, `pg_policies` and `pg_views` and asserts: every table is in the manifest; every T, C, M and P table has RLS enabled and forced; every T, C and M table has at least one policy; every P table has none; every G table has RLS off; every view has `security_invoker`. A new table with no manifest entry fails this test, which is the guard against future drift.

### 6.3 Whole suite under RLS

`tests/db/fixtures/db-role.ts` gains `RLS_TEST_ROLE=1`: after connecting, every test client runs `SET ROLE kh_rls_app` and `set_config` for the business it fixtures. The existing 130+ `tests/db/*.db.test.ts` files then exercise their real SQL under RLS. Failures found this way are either missing context in library code (fix the code) or a policy too narrow (fix the manifest). This run is the gate before staging.

### 6.4 Route-level and live tests

- `tests/security/*` (mocked `query`): add an assertion helper `expectTenantContext(businessId)` that checks `currentTenant()` inside the mocked `query` for the core isolation routes.
- `tests/live/run-security-regressions.mjs` against staging: sign in as business A, request business B's invoice, customer, store order and employee by id, expect 403 or 404 and never a body; run `check-rls.sql` through SSH and assert `tables_with_rls` equals the manifest count.

## 7. Rollout and rollback

Guardrail from `AGENTS.md`: nobody but the owner runs migrations against staging or production, and production deploys from the `production` branch, not `main`. Every step below that touches a server is an owner action.

### 7.1 What a deploy carries

- Migration 467 creates the two functions, all policies, and the view option. **Policies on a table with RLS disabled are inert**, so this migration changes nothing observable and goes out with the normal `scripts/deploy-vps.sh` (which runs `npm run db:migrate:pending` before the build).
- Enabling and disabling RLS are not migrations. `scripts/rls/enable.js --confirm <dbname>` and `scripts/rls/disable.js --confirm <dbname>` generate `ALTER TABLE ... ENABLE/FORCE` or `NO FORCE/DISABLE` for every manifest table from the manifest and run them in one transaction as `postgres` (through `MIGRATION_DATABASE_URL`). They refuse to run without the exact database name, and refuse `kh_phase2_test` unless `--allow-test`.
- Index creation (§3.8) runs as `scripts/rls/create-indexes.js` with `CONCURRENTLY`, before enabling.

### 7.2 Staging sequence

1. **Roles and env.** On the VPS as `postgres`: `database/scripts/create-rls-system-role.sql` (prompts for the password; nothing stored in git). Add `DB_SYSTEM_USER`, `DB_SYSTEM_PASSWORD`, `DB_POOL_MAX`, `DB_SYSTEM_POOL_MAX` to `/var/www/khatario/.env` and `RLS_CONTEXT_MODE=warn`. Record `SHOW server_version` (must be 15 or later for `security_invoker`) and `SHOW max_connections`.
2. **Deploy the code** with migration 467. RLS is off; the app now sets the session settings on every checkout and logs missing-context statements.
3. **Null audit.** Run `scripts/rls/audit-nullable.js` (counts NULL `business_id` per T-nullable table) and fix orphans with the follow-up migration it prints. Run `scripts/rls/create-indexes.js`.
4. **Burn-in, warn mode, at least three working days** covering a cron cycle, a WhatsApp reconnect, a storefront order, an employee-portal check-in and a platform-admin session. `pm2 logs khatario | grep rls-context` must be empty for a full day before moving on. Each hit is a code fix (§4.3, §4.4).
5. **Enforce mode in the app**: `RLS_CONTEXT_MODE=enforce`, `pm2 reload`. Same checks for two days. The database still has RLS off, so a missed path fails loudly with a 500 that names the table, not with wrong data.
6. **Enable in the database**, quiet window: `node scripts/rls/enable.js --confirm khatario`. Takes seconds (catalog flags only). Then `sudo -u postgres psql -d khatario -f database/scripts/check-rls.sql` must show every T, C, M, P table enabled and forced and no policy on P tables.
7. **Smoke and watch.** The staging QA checklist in `docs/qa/README.md` plus: login, invoice list and create, store order on the E2E store, employee check-in, platform admin business list, each cron URL with the Bearer secret, the Baileys worker log, a backup run with a row-count check. Watch `pm2 logs` for `42501`, `permission denied for table`, and `TenantContextMissingError` for a week.
8. **Live regressions**: `npm run test:qa:security-live` with the RLS cases from §6.4.

### 7.3 Rollback

- **Database (seconds, no data change):** `node scripts/rls/disable.js --confirm khatario`. Policies stay in place but inert; a later `enable.js` turns them back on without re-running any migration.
- **App:** set `RLS_CONTEXT_MODE=warn` (or `off`) and `pm2 reload`. The context plumbing is harmless with RLS disabled.
- **Code:** the previous release through the existing deploy script (`git checkout <previous tag>` then `bash scripts/deploy-vps.sh`); migration 467 does not need reverting because inert policies and the two functions cannot break old code.
- **If a policy is wrong for one table only:** `ALTER TABLE <t> DISABLE ROW LEVEL SECURITY` for that table, fix the manifest, regenerate, re-enable. The coverage test fails until the manifest and the database agree again.

### 7.4 Production

Same sequence on `/var/www/khatario-prod`, `.env.production`, database `khatario_prod`, branch `production`, after staging has run a full week in step 7 without an `rls-context` or `42501` entry. Before step 6: `sudo -u postgres pg_dump -Fc khatario_prod > /var/backups/khatario_prod-pre-rls-$(date +%F).dump` and verify its size against the previous backup. Warn-mode burn-in on production is shorter (two days) because the paths were proven on staging, but it is not skipped: production has tenants and flows (real WhatsApp numbers, live payments) that staging does not.

### 7.5 After production: make it permanent

Migration 468 (`466_rls_enforce.sql`) runs `ENABLE` and `FORCE` for every manifest table so that a fresh database built by `scripts/setup-khatario-production.sh` (which copies the staging schema with `pg_dump --schema-only`) and any future environment start with RLS on. It is written only after production has been stable for two weeks, and `enable.js` becomes idempotent housekeeping.

## 8. Known limits

- RLS does not protect against a tenant's own over-privileged users; PBAC still does that.
- A statement that runs as `postgres` (scripts, migrations, backups) sees everything by design. Nothing in the app runs as `postgres`.
- `EXISTS` policies on child tables add a primary-key probe per row. If a report over a large child table slows down measurably, denormalise `business_id` into that table (backfill in batches, add it to the manifest as class T) as a separate change.
- `enterTenant` relies on `AsyncLocalStorage.enterWith`, which binds the context to the rest of the current async flow. It is used only where a guard cannot wrap the handler; the unit tests cover it.
