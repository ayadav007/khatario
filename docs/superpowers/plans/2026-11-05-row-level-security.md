# Row Level Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postgres enforces the tenant boundary on every statement the app role runs, on staging first and then production, with instant rollback and no data migration.

**Architecture:** A manifest classifies every table; a generator turns it into one migration of inert policies plus enable/disable scripts. `lib/db.ts` sets `khatario.business_id` and `khatario.user_id` on every pool checkout from an `AsyncLocalStorage` context that falls back to the middleware's trusted headers, and routes system work to a second `BYPASSRLS` role. A warn-then-enforce app mode proves context coverage on staging before the database flag is flipped.

**Tech Stack:** Postgres 15+ (`security_invoker` views), `pg` 8, Next.js 14 App Router (`next/headers`), Node `AsyncLocalStorage`, BullMQ 5, Jest with `ts-jest`, the disposable database `kh_phase2_test`.

**Spec:** `docs/superpowers/specs/2026-11-05-row-level-security-design.md` (section numbers below refer to it).

## Global Constraints

- Never run a migration or `scripts/rls/enable.js` against staging or production from this plan; only the owner does, in a quiet window (`AGENTS.md`). Tests use `kh_phase2_test` only.
- Stage files by name; never `git add .`.
- Setting names are exactly `khatario.business_id` and `khatario.user_id`; functions are `khatario_business_id()` and `khatario_user_id()`; policies are named `tenant_isolation`, or `tenant_read` / `tenant_write` / `tenant_update` / `tenant_delete` where split (spec §3).
- Policies carry no `TO` clause (spec §1).
- Every protected table gets both `ENABLE` and `FORCE ROW LEVEL SECURITY`.
- Migration numbering continues from 465. Migration 465 must be inert on a database with RLS disabled.
- No DB password or secret in any committed file or log line.
- `graphify update .` after code changes if the tool is installed.

## Review Focus

1. A pool client checked out by tenant A, released, then checked out by tenant B must run as B: Task 3's `re-issues set_config when the tenant changes` test pins it.
2. A request with no session on a public path reaching a tenant table must get zero rows and a failed write, never another tenant's data: Task 9's `no context` row pins it at the database; Task 3's enforce-mode test pins it in the app.
3. A user who belongs to two businesses and switches must see the new business after the JWT refresh and nothing of the old one in the same request: Task 9's identity case plus Task 6's `switch` route test.
4. A backup taken as the app role after enabling would be silently empty: Task 10's runbook step adds a row-count check, and Task 5's role script comments state that `pg_dump` runs as `postgres`.
5. A platform admin impersonating a business must act as that business, not as system: Task 2's resolution test with both headers present pins `tenant` mode winning.

---

### Task 1: Manifest, generator and coverage verifier

**Files:**
- Create: `database/rls/manifest.json`
- Create: `scripts/rls/lib.js` (manifest loader, class validation, policy SQL rendering)
- Create: `scripts/rls/generate-policies.js`
- Create: `scripts/rls/verify-coverage.js`
- Create: `scripts/rls/audit-nullable.js`
- Create: `scripts/rls/generate-table-list.js` → writes `lib/db/rls-tables.generated.ts`
- Test: `tests/scripts/rls-manifest.test.ts`

**Interfaces:**
- Produces `database/rls/manifest.json`: `{ "tables": { "<name>": Entry } }` where `Entry` is one of
  `{ "class": "tenant", "column": "business_id", "nullable": "strict" | "shared" }`,
  `{ "class": "child", "parent": "<table>", "fk": "<column>" }` (parent may itself be child or multi-party; the renderer follows the chain),
  `{ "class": "multi", "columns": ["buyer_business_id", "vendor_business_id"], "readAny": false }`,
  `{ "class": "identity", "policy": "users" | "businesses" | "user_businesses" }`,
  `{ "class": "platform" }`, `{ "class": "global" }`.
- Produces `renderPolicies(manifest): string` and `renderEnable(manifest, enable: boolean): string` in `scripts/rls/lib.js`, used by Tasks 4 and 5.
- Produces `lib/db/rls-tables.generated.ts` exporting `RLS_TABLES: ReadonlySet<string>` (every non-global table), used by Task 3.

- [ ] **Step 1: Write the failing manifest test**

```ts
// tests/scripts/rls-manifest.test.ts
import { loadManifest, renderPolicies, renderEnable } from '../../scripts/rls/lib';

test('every entry has a known class and the fields that class needs', () => {
  const m = loadManifest();
  for (const [name, e] of Object.entries(m.tables)) {
    expect(['tenant', 'child', 'multi', 'identity', 'platform', 'global']).toContain(e.class);
    if (e.class === 'child') expect(m.tables[e.parent]).toBeDefined();
  }
});
test('child chains terminate at a tenant, multi or identity table', () => { /* walk parents, max depth 3 */ });
test('renders the spec §3 SQL for one table of each class', () => {
  const sql = renderPolicies(loadManifest());
  expect(sql).toContain('CREATE POLICY tenant_isolation ON invoices');
  expect(sql).toContain('WHERE p.id = invoice_items.invoice_id');
  expect(sql).toContain("khatario_business_id() IN (buyer_business_id, vendor_business_id)");
  expect(sql).not.toMatch(/CREATE POLICY \w+ ON platform_admins/);
  expect(sql).not.toMatch(/ROW LEVEL SECURITY/);   // 465 is inert: no ENABLE here
});
test('renderEnable emits ENABLE and FORCE for every non-global table and nothing for global ones', () => { /* ... */ });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx jest tests/scripts/rls-manifest.test.ts`
Expected: FAIL, cannot find module `scripts/rls/lib`.

- [ ] **Step 3: Build the manifest from the inventory**

Classify every table per spec §2 (the lists there are the starting point). Use the SQL parser approach from the audit (CREATE TABLE and ALTER TABLE over `database/schema.sql` + `database/migrations/*.sql`) as a one-off helper to seed the file, then hand-check the three identity entries, the 14 multi-party entries and every child's parent. For `supplier_connection_requests` confirm the accepted-status column and value used in spec §3.4 and record them in the manifest entry (`"acceptedWhere": "status = 'accepted'"`).

- [ ] **Step 4: Implement `scripts/rls/lib.js`**

`loadManifest(): Manifest`, `renderPolicies(m): string` (functions + `DROP POLICY IF EXISTS` + `CREATE POLICY` per spec §3, plus `ALTER VIEW ... SET (security_invoker = true)` for the four views), `renderEnable(m, enable): string`, `tenantPredicate(m, table, alias): string` (recursive for child chains). Plain Node, no TypeScript, so the scripts run on the VPS without a build.

- [ ] **Step 5: Implement the four scripts**

- `generate-policies.js` writes `database/migrations/465_rls_policies.sql` with a header comment naming the manifest and the generator; refuses to overwrite a file whose header says it was hand-edited.
- `verify-coverage.js`: connects with `getMigrationDbConfig()` from `scripts/db-config.js`, lists `pg_tables` in `public`, exits 1 naming any table missing from the manifest or any manifest table missing from the database, and prints the live RLS state per class.
- `audit-nullable.js`: for every `tenant` entry, `SELECT count(*) WHERE business_id IS NULL`; prints a table and, for tables with `"nullable": "strict"` and NULL rows, a ready-to-review `UPDATE`/`DELETE` plan it does not execute.
- `generate-table-list.js`: writes `lib/db/rls-tables.generated.ts`.

- [ ] **Step 6: Run the test and the generator**

Run: `npx jest tests/scripts/rls-manifest.test.ts && node scripts/rls/generate-table-list.js && node scripts/rls/generate-policies.js`
Expected: PASS; `database/migrations/465_rls_policies.sql` and `lib/db/rls-tables.generated.ts` written.

- [ ] **Step 7: Commit**

```bash
git add database/rls/manifest.json scripts/rls/lib.js scripts/rls/generate-policies.js scripts/rls/verify-coverage.js scripts/rls/audit-nullable.js scripts/rls/generate-table-list.js lib/db/rls-tables.generated.ts database/migrations/465_rls_policies.sql tests/scripts/rls-manifest.test.ts
git commit -m "rls: table manifest, policy generator and coverage verifier"
```

---

### Task 2: Tenant context module

**Files:**
- Create: `lib/tenant-context.ts`
- Test: `tests/lib/tenant-context.test.ts`

**Interfaces:**
- Produces the exports in spec §4.1: `runWithTenant`, `runAsSystem`, `enterTenant`, `currentTenant`, type `TenantContext`, and `contextKey(ctx): string` (`tenant:<businessId>:<userId>` or `system`), used by Task 3.
- Header fallback reads `x-authenticated-business-id`, `x-authenticated-user-id`, `x-platform-admin-id` through a guarded `require('next/headers')`.

- [ ] **Step 1: Write the failing tests**

```ts
jest.mock('next/headers', () => ({ headers: () => mockHeaders }), { virtual: true });
test('explicit runWithTenant wins over headers', ...)            // headers say B, runWithTenant(A) → A, source 'explicit'
test('headers give a tenant context inside a request', ...)      // → businessId from header, source 'header'
test('platform-admin header alone gives system mode', ...)       // x-platform-admin-id only → { mode: 'system', reason: 'platform-admin' }
test('business header plus platform-admin header gives tenant mode', ...)   // impersonation: tenant wins
test('no store and headers() throwing gives source none', ...)   // mockHeaders throws → { businessId: null, source: 'none' }
test('enterTenant binds the rest of the async flow', async () => { enterTenant('A'); await Promise.resolve(); expect(currentTenant()).toMatchObject({ businessId: 'A' }); });
test('runAsSystem inside runWithTenant yields system for its scope only', ...)
test('contextKey is stable and distinguishes user', ...)
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest tests/lib/tenant-context.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/tenant-context.ts`**

One `AsyncLocalStorage<TenantContext>`. `currentTenant()` follows the three-step order in spec §4.1. UUID-validate header values with the same regex `middleware.ts` uses (line 56) and treat an invalid value as absent.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/lib/tenant-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tenant-context.ts tests/lib/tenant-context.test.ts
git commit -m "rls: tenant context with header fallback and system mode"
```

---

### Task 3: Tenant-aware pool in `lib/db.ts`

**Files:**
- Modify: `lib/db.ts` (whole file; keep every existing export name and signature)
- Create: `lib/db/tenant-pool.ts`
- Modify: `env.example`, `ENV_VARIABLES_GUIDE.md` (the four new variables, spec §4.2)
- Test: `tests/lib/db-tenant-pool.test.ts`

**Interfaces:**
- Consumes `currentTenant`, `contextKey` from Task 2 and `RLS_TABLES` from Task 1.
- Produces `class TenantPool { connect(): Promise<PoolClient>; query(text, params?): Promise<QueryResult>; end(); on(...) }` wrapping a `pg.Pool`; `getPool()` now returns the tenant pool, or the system pool when `currentTenant().mode === 'system'`; new `getSystemPool()`; new error class `TenantContextMissingError extends Error { table: string }`.
- `RLS_CONTEXT_MODE` read at each call (so `pm2 reload --update-env` picks a change up).

- [ ] **Step 1: Write the failing tests** (mock `pg` with a fake pool whose clients record queries)

```ts
test('first checkout under tenant A runs set_config with A', ...)                 // expects one query `SELECT set_config('khatario.business_id', $1, false), set_config('khatario.user_id', $2, false)` with ['A', 'u1']
test('same client reused under A does not re-run set_config', ...)
test('re-issues set_config when the tenant changes', ...)                          // Review Focus 1
test('failed set_config releases the client with the error and rethrows', ...)
test('system mode uses the system pool and never calls set_config', ...)
test('enforce mode throws TenantContextMissingError for a tenant table with no context', ...)   // 'SELECT * FROM invoices' → throws, table 'invoices'
test('enforce mode allows a global table with no context', ...)                    // 'SELECT * FROM subscription_plans' → ok
test('warn mode logs once per call site and proceeds', ...)
test('pool sizes come from DB_POOL_MAX and DB_SYSTEM_POOL_MAX with defaults 40 and 10', ...)
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest tests/lib/db-tenant-pool.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/db/tenant-pool.ts` and rewire `lib/db.ts`**

Per spec §4.2 and §5.4. The table-name match for the context guard: lower-case the SQL, find `\b(from|join|into|update|delete\s+from)\s+"?(\w+)"?` tokens, test each against `RLS_TABLES`; cache the per-statement verdict in a `Map<string, string | null>` capped at 2,000 entries. The system pool is built from `DATABASE_SYSTEM_URL` or `DB_SYSTEM_USER`/`DB_SYSTEM_PASSWORD` with the tenant pool's host, port, database and SSL; when neither is set, `getSystemPool()` throws `SystemPoolNotConfiguredError` with the variable names in the message (so a misconfigured server fails at the first platform-admin or cron request, not silently as the app role).

- [ ] **Step 4: Run the new test and the existing suites that mock `lib/db`**

Run: `npx jest tests/lib/db-tenant-pool.test.ts tests/security --runInBand`
Expected: PASS; the security suites still mock `query` by module path, which is unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts lib/db/tenant-pool.ts env.example ENV_VARIABLES_GUIDE.md tests/lib/db-tenant-pool.test.ts
git commit -m "rls: tenant-aware pool, system pool and context guard"
```

---

### Task 4: Migration 465 applied to the test database

**Files:**
- Already generated: `database/migrations/465_rls_policies.sql` (Task 1)
- Create: `tests/db/fixtures/rls-role.ts` (creates `kh_rls_app` NOLOGIN with `GRANT ALL ON ALL TABLES/SEQUENCES IN SCHEMA public` and `kh_rls_system` NOLOGIN BYPASSRLS; exports `asApp(client, businessId, userId?)`, `asSystem(client)`, `reset(client)`)
- Test: `tests/db/rls-policies-inert.db.test.ts` (opt-in `RLS_DB_TEST=1`, connects only when `current_database() = 'kh_phase2_test'`, same guard as `tests/db/phase3a-auth-isolation.db.test.ts`)

- [ ] **Step 1: Write the failing test**

```ts
test('465 creates khatario_business_id() and one policy set per manifest table', ...)   // pg_policies count by table matches manifest classes tenant/child/multi/identity
test('with RLS disabled the policies are inert', ...)                                   // SET ROLE kh_rls_app, no setting, SELECT count(*) FROM invoices equals the superuser count
test('all four views have security_invoker', ...)                                       // pg_class.reloptions
```

- [ ] **Step 2: Run to see it fail** (functions missing)

Run: `RLS_DB_TEST=1 npx jest tests/db/rls-policies-inert.db.test.ts`
Expected: FAIL.

- [ ] **Step 3: Apply 465 to the test database**

Run: `node scripts/run-migration.js database/migrations/465_rls_policies.sql` with `.env` pointing at `kh_phase2_test` (the runner refuses otherwise only through the repo convention; confirm `DB_NAME` before running).

- [ ] **Step 4: Run the test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/db/fixtures/rls-role.ts tests/db/rls-policies-inert.db.test.ts
git commit -m "rls: policies migration verified inert on the test database"
```

---

### Task 5: Enable, disable, index and role scripts

**Files:**
- Create: `scripts/rls/enable.js`, `scripts/rls/disable.js`, `scripts/rls/create-indexes.js`
- Create: `database/scripts/create-rls-system-role.sql`
- Modify: `package.json` scripts: `rls:verify`, `rls:audit-nullable`, `rls:enable`, `rls:disable`, `rls:indexes`
- Test: `tests/scripts/rls-enable-guard.test.ts` and `tests/db/rls-enable-roundtrip.db.test.ts`

**Interfaces:**
- Consumes `renderEnable` from Task 1.
- `enable.js` / `disable.js` CLI: `--confirm <dbname>` required and must equal `current_database()`; `--allow-test` required when the name is `kh_phase2_test`; `--dry-run` prints the SQL. Exit 2 on a guard failure before any connection is opened.
- `create-indexes.js`: for each `tenant` table without an index whose first column is `business_id` (query `pg_index` + `pg_attribute`), runs `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_<table>_business_id ON <table> (business_id)` outside any transaction; `--dry-run` lists them.

- [ ] **Step 1: Write the failing guard tests** (pure functions `parseArgs`, `guardDatabase(actual, args)` exported from `enable.js`)

```ts
test('refuses without --confirm', ...); test('refuses when --confirm differs from current_database', ...);
test('refuses kh_phase2_test without --allow-test', ...); test('dry-run prints ENABLE and FORCE for invoices and nothing for subscription_plans', ...)
```

- [ ] **Step 2: Write the failing round-trip db test**

```ts
test('enable then disable on kh_phase2_test', async () => {
  // run enable.js with --confirm kh_phase2_test --allow-test; as kh_rls_app with no setting: count(*) FROM invoices = 0
  // run disable.js; same count equals the superuser count
});
```

- [ ] **Step 3: Run both to see them fail**

- [ ] **Step 4: Implement the three scripts and the role SQL**

`create-rls-system-role.sql` uses `\prompt 'Password for khatario_system: ' pw` then `CREATE ROLE khatario_system LOGIN BYPASSRLS PASSWORD :'pw'; GRANT khatario_user TO khatario_system;` and a comment block stating that `pg_dump` and migrations keep running as `postgres`.

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/scripts/rls-enable-guard.test.ts && RLS_DB_TEST=1 npx jest tests/db/rls-enable-roundtrip.db.test.ts`
Expected: PASS, and the test database is left with RLS disabled.

- [ ] **Step 6: Commit**

```bash
git add scripts/rls/enable.js scripts/rls/disable.js scripts/rls/create-indexes.js database/scripts/create-rls-system-role.sql package.json tests/scripts/rls-enable-guard.test.ts tests/db/rls-enable-roundtrip.db.test.ts
git commit -m "rls: enable, disable, index and system-role scripts"
```

---

### Task 6: Explicit contexts for pre-auth, portal, storefront and webhook paths

**Files:**
- Modify: `app/api/auth/login/route.ts`, `refresh/route.ts`, `forgot-password/route.ts`, `reset-password/route.ts`, `impersonate/route.ts`, `session/route.ts`; the add-business route under `app/api/businesses` (the one `tests/security/add-business-route.test.ts` covers); `app/api/public/platform-otp/route.ts`; `app/api/partners/auth/*/route.ts`
- Modify: `lib/employee-portal/portal-api-guard.ts`, `lib/hr/recruitment/candidate-portal-session.ts`, `lib/store/customer-session.ts`, `lib/partners/request-auth.ts`
- Modify: `lib/store/resolve-store.ts` (`resolveStoreBySubdomain` body under `runAsSystem('store-resolve')`), `lib/store/preview-store.ts`
- Create: `withStoreTenant` in `lib/store/engine/route-utils.ts`; adopt it in the 23 routes under `app/api/public/store/[subdomain]` and the store pages that call `resolveStoreBySubdomain`
- Modify: `app/api/public/i/*`, `wa-shop/*`, `wa-widget/*`, `supplier-order/*`, `portal/*`, `rider/*`, `candidate/*`, `employee/*` route files (token lookup as system, then `enterTenant`)
- Modify: `app/api/webhooks/leads`, `meta-whatsapp`, `platform-billing`, `store` route files
- Test: `tests/security/rls-context-routes.test.ts`

**Interfaces:**
- Consumes `runAsSystem`, `runWithTenant`, `enterTenant`, `currentTenant` (Task 2).
- Produces `withStoreTenant(request: NextRequest, params: { subdomain: string }, handler: (ctx: { store: ResolvedStore; businessId: string }) => Promise<NextResponse>): Promise<NextResponse>`.

- [ ] **Step 1: Write the failing tests**

Mock `@/lib/db` `query` to record `currentTenant()` at call time (helper `recordingQueryMock()` added to `tests/security/helpers/mock-deps.ts`). For each route group one test:

```ts
test('login runs every query in system mode', ...)
test('store subdomain route resolves as system then runs the handler as the store business', ...)   // first call system, later calls tenant = store.business_id
test('employee portal cookie session: lookup as system, handler as the employee business', ...)
test('meta-whatsapp webhook runs the business lookup as system and the message write as that tenant', ...)
test('switch business route stays in tenant mode and uses the session business', ...)              // Review Focus 3
```

- [ ] **Step 2: Run to see them fail**

- [ ] **Step 3: Apply the wrappers**

Smallest change per file: wrap the existing handler body in `runAsSystem('<reason>', async () => { ... })` or `runWithTenant(...)`; the guards call `enterTenant` right after they learn `businessId`.

- [ ] **Step 4: Run the test file and the whole security suite**

Run: `npx jest tests/security --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add <the files above>   # by name
git commit -m "rls: explicit contexts for auth, portals, storefront and webhooks"
```

---

### Task 7: Cron routes, queues and workers

**Files:**
- Modify: the 34 route files that import `assertCronAuthorized` (list with `grep -rl assertCronAuthorized app/api`)
- Modify: `lib/queue/paymentReminderQueue.ts`, `lib/queue/todoReminderQueue.ts`, `lib/queue/syncTodoReminderJob.ts`, `lib/workers/todoReminderWorker.ts`, `lib/workers/kbIndexWorker.ts`, `scripts/whatsapp-worker.ts`, `scripts/whatsapp-message-worker.ts`, `lib/baileys-hybrid.ts`, `lib/whatsapp.ts`, `workers/marketing/*`
- Modify: `deploy/pm2/khatario.config.cjs` and the staging PM2 ecosystem it mirrors: `DB_POOL_MAX`, `DB_SYSTEM_POOL_MAX` on worker entries (spec §5.3)
- Test: `tests/lib/queue/rls-job-context.test.ts`, extend `tests/security/check-reminders-route.test.ts` and `tests/security/cron-auth.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('payment reminder processor runs under the job businessId', ...)
test('todo reminder processor rejects a job without businessId', ...)       // throws before any query
test('kb nightly enumerates tenants as system and reindexes each as that tenant', ...)
test('send-payment-reminders cron enumerates as system and processes each business as tenant', ...)
test('baileys socket handlers registered for business A run their db writes as A', ...)   // mock makeWASocket, emit a messages.upsert, assert currentTenant inside the mocked query
```

- [ ] **Step 2: Run to see them fail**

- [ ] **Step 3: Apply the wrappers**

Cron pattern:

```ts
const businesses = await runAsSystem('cron-enumerate', () => db.queryRows(...));
for (const b of businesses) await runWithTenant(b.business_id, () => processBusiness(b));
```

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/lib/queue tests/security/check-reminders-route.test.ts tests/security/cron-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "rls: tenant context in cron routes, queues and workers"
```

---

### Task 8: Platform-private reads from tenant code

**Files:**
- Create: `lib/platform/settings.ts` (`getPlatformRazorpayKeys()`, `getPlatformVapidKeys()`, `getPlatformMetaWaConfig()`, each `runAsSystem('platform-read:platform_settings')`), `lib/platform/whatsapp-templates.ts`, `lib/platform/promotions.ts`, `lib/platform/partners.ts`
- Modify: the 19 files found by `grep -rlE 'platform_settings|platform_whatsapp_templates|platform_promotions|platform_partners' --include='*.ts' lib app | grep -v app/api/admin`
- Test: `tests/lib/platform/accessors.test.ts`

- [ ] **Step 1: Write the failing tests**: each accessor runs its query in system mode and returns only the named fields (no `encrypted_*` columns in the result object).
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement the accessors and replace the direct reads.**
- [ ] **Step 4: Run** `npx jest tests/lib/platform` and `npx tsc --noEmit -p tsconfig.json`. Expected: PASS, no new type errors (compare against `tsc-errors.txt`).
- [ ] **Step 5: Commit** `rls: system-role accessors for platform tables`.

---

### Task 9: Cross-tenant database tests and the whole suite under RLS

**Files:**
- Create: `tests/db/rls-isolation.db.test.ts` (the matrix in spec §6.2)
- Create: `tests/db/rls-coverage.db.test.ts` (spec §6.2 last paragraph; reads `database/rls/manifest.json`)
- Modify: the shared db-test connection helper used by `tests/db/*.db.test.ts` (the `forceDisposableDatabase` pattern in `tests/db/phase3a-auth-isolation.db.test.ts`; extract it to `tests/db/fixtures/db-role.ts` if it is still copied per file) to honour `RLS_TEST_ROLE=1`: after connect, `SET ROLE kh_rls_app` and `set_config` for the fixture's business
- Modify: `package.json`: `test:db:rls` = `RLS_DB_TEST=1 RLS_TEST_ROLE=1 jest tests/db --runInBand`

- [ ] **Step 1: Write `rls-isolation.db.test.ts`** with the thirteen cases from spec §6.2, each asserting the exact expected count or the SQLSTATE `42501`.
- [ ] **Step 2: Write `rls-coverage.db.test.ts`.**
- [ ] **Step 3: Enable RLS on the test database** (`node scripts/rls/enable.js --confirm kh_phase2_test --allow-test`) and run both: `RLS_DB_TEST=1 npx jest tests/db/rls-isolation.db.test.ts tests/db/rls-coverage.db.test.ts`. Expected: PASS. Fix the manifest and regenerate 465 for any policy found too narrow or too wide; re-apply 465 to the test database.
- [ ] **Step 4: Run the whole db suite under the app role**: `npm run test:db:rls`. Record every failure in `docs/qa/rls-suite-run.md` with its cause (missing context in library code → fix in code; policy too narrow → fix in manifest). Repeat until green.
- [ ] **Step 5: Run the existing suites once more without the role** (`npx jest`) to confirm nothing regressed for superuser runs.
- [ ] **Step 6: Disable RLS on the test database** (`node scripts/rls/disable.js --confirm kh_phase2_test --allow-test`) so other work is unaffected; note in `docs/qa/README.md` how to turn it on.
- [ ] **Step 7: Commit** `rls: cross-tenant isolation and coverage tests; full db suite under the app role`.

---

### Task 10: Runbook, live regressions, roadmap

**Files:**
- Modify: `docs/SERVER_INFRASTRUCTURE.md`: new section "Row Level Security (migration 465, staging first)" with spec §7.2, §7.3, §7.4 as numbered owner steps, including the backup row-count check (`pg_restore --list` plus `SELECT count(*) FROM invoices` on a scratch restore, or `pg_dump ... | grep -c '^COPY public.invoices'` with a non-zero row block)
- Modify: `tests/live/run-security-regressions.mjs`: the cross-tenant id probes and the `check-rls.sql` count assertion from spec §6.4 (the SSH step reads `STAGING_SSH` from the environment and is skipped when unset)
- Modify: `database/scripts/check-rls.sql`: add a fourth section that counts tables per manifest class when `database/rls/manifest.json` is present (as a `\set` of the expected total written by the generator into `database/rls/expected-counts.sql`)
- Modify: `docs/roadmap.md`: card under **Next**: "Row Level Security: built on main, test suite green under the app role; next: owner runs the role script and env on staging, deploy with 465, warn-mode burn-in, enforce, enable (spec §7.2) [[docs/superpowers/specs/2026-11-05-row-level-security-design.md]] [[docs/superpowers/plans/2026-11-05-row-level-security.md]]"
- Append: `docs/project.log.md` entry

- [ ] **Step 1: Write the runbook section** and have each command match the scripts' real flags (`--confirm khatario`, `--confirm khatario_prod`).
- [ ] **Step 2: Extend the live regression script**; run it against staging only after the owner has completed §7.2 step 6 (until then run with `RLS_LIVE_SKIP=1` to check it parses).
- [ ] **Step 3: Update the roadmap and project log.**
- [ ] **Step 4: Commit** `rls: runbook, live regressions and roadmap card`.

---

### Task 11 (after production is stable for two weeks): migration 466

**Files:**
- Create: `database/migrations/466_rls_enforce.sql` (output of `renderEnable(manifest, true)` with a header stating it is idempotent and that `scripts/rls/disable.js` remains the rollback)
- Test: `tests/scripts/rls-manifest.test.ts` gains `466 matches renderEnable(manifest, true)` so the file cannot drift from the manifest.

- [ ] **Step 1: Generate, test, commit** `rls: enforce RLS for fresh databases (466)`.
