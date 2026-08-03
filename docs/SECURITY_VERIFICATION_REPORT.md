# Security Verification Report

**Auditor role:** Independent principal security auditor (source-code verification only)  
**Date:** 2026-06-06  
**Scope:** Security foundation, P0 fixes, tenant isolation, premium modules, automated tests, audit scripts  
**Method:** Direct inspection of `app/api/**`, `lib/security/**`, `tests/security/**`; fresh execution of audit scripts. Documentation, comments, and prior reports were not used as evidence.

---

## Final Verdict: **FAIL**

Pass criteria require Critical = 0, High = 0, no confirmed tenant isolation vulnerabilities, and no premium routes missing subscription enforcement. All four conditions are not met.

| Criterion | Result |
|-----------|--------|
| Critical findings (audit script) | **72** |
| High findings (audit script) | **229** |
| Confirmed tenant isolation vulnerabilities | **Yes** (multiple routes) |
| Premium routes missing subscription enforcement | **Yes** (19 WhatsApp routes) |

---

## Phase 1 — Security Foundation

### Locations

| Symbol | File |
|--------|------|
| `requireOperationalSubscription()` | `lib/security/require-operational-subscription.ts` (lines 31–98) |
| `assertOperationalSubscription()` | `lib/security/require-operational-subscription.ts` (lines 112–128) |
| `withBusinessApi()` | `lib/security/with-business-api.ts` (lines 68–169) |
| Production entry wrappers | `lib/security/premium-module-api.ts` (`withPremiumSubscriptionApi`, `withWhatsAppPremiumApi`) |

### Existence and compilation

- Both functions **exist** in the repository.
- `npx tsc --noEmit` **passes** (full project, 2026-06-06).
- `npm run test:security` **passes** (84/84 tests).

### Production references (not dead code)

| Symbol | Referenced by |
|--------|---------------|
| `requireOperationalSubscription` | `lib/security/with-business-api.ts`, `lib/gst/gstr2b-route-guard.ts`, `lib/security/index.ts` |
| `withBusinessApi` | `lib/security/premium-module-api.ts` → **66+ route files** via `withPremiumSubscriptionApi` / `withWhatsAppPremiumApi` |

`lib/security/examples.ts` is reference-only; **no route imports it**. It is documentation, not runtime enforcement.

### Deny/allow behavior (verified in source)

`requireOperationalSubscription()` rejects:

| Condition | Code path |
|-----------|-----------|
| Empty business ID | `NO_SUBSCRIPTION` (403) |
| Platform suspended | `BUSINESS_SUSPENDED` (403) via `isBusinessPlatformSuspended()` |
| No subscription row | `NO_SUBSCRIPTION` (403) |
| Status `expired` | `SUBSCRIPTION_EXPIRED` (403) |
| Status `cancelled` | `SUBSCRIPTION_CANCELLED` (403) |
| Other non-operational status | `SUBSCRIPTION_INACTIVE` (403) |
| Expired trial (no grace) | `TRIAL_EXPIRED` (403) via `checkTrialExpiry()` |
| Past `end_date` | `SUBSCRIPTION_EXPIRED` (403) |

Allows:

| Condition | Code path |
|-----------|-----------|
| Status `active` | Returns subscription row |
| Status `trial` (not expired) | Returns subscription row |

Unit tests in `tests/security/require-operational-subscription.test.ts` exercise all scenario IDs in `fixtures/subscription-scenarios.ts`.

**Phase 1 result: PASS** (foundation exists, compiles, is used in production, logic matches spec).

---

## Phase 2 — P0 Fix Verification

### `/api/cron/*` (9 unique route files)

| Route | Middleware / auth chain | Tenant | Subscription | Verdict |
|-------|-------------------------|--------|--------------|---------|
| `/api/cron/check-low-stock` | `assertCronAuthorized` → 503 if `CRON_SECRET` missing, 401 if wrong bearer | N/A (system job) | N/A | **PASS** |
| `/api/cron/check-subscriptions` | Same | N/A | N/A | **PASS** |
| `/api/cron/process-campaigns` | Same (`lib/cron-auth.ts` lines 8–21) | N/A | N/A | **PASS** |
| `/api/cron/process-reversing-entries` | Same | N/A | N/A | **PASS** |
| `/api/cron/process-scheduled-backups` | Same | N/A | N/A | **PASS** |
| `/api/cron/refresh-profile-pictures` | Same | N/A | N/A | **PASS** |
| `/api/cron/send-daily-invoice-summary` | Same | N/A | N/A | **PASS** |
| `/api/cron/send-payment-reminders` | Same | N/A | N/A | **PASS** |
| `/api/cron/send-todo-reminders` | Same | N/A | N/A | **PASS** |

All nine routes call `assertCronAuthorized` before executing work. Unauthenticated cron invocation vulnerability **fixed**.

### `/api/items/import`

| Check | Implementation |
|-------|----------------|
| Auth | `getUserIdFromRequest` → 401 |
| Tenant | `requireTenantBusinessId(request, body.business_id)` |
| RBAC | `authorize(userId, 'items', 'create')` |
| Subscription / limits | `enforceAccess({ limitType: 'items' })`, `checkLimit` |

**PASS** — client `business_id` cannot override JWT tenant; subscription limits enforced.

### `/api/gst/gstr2b/*`

Guard: `lib/gst/gstr2b-route-guard.ts` → `assertGstr2bApiAccess()`:

1. `requireTenantBusinessId`
2. `getUserIdFromRequest` → 401
3. `assertOperationalSubscription`
4. `assertReportAccess(..., 'gst')`
5. `authorize(..., 'report.gst', ...)`

Routes: `import`, `export`, `reconcile`, `decision` — all use this guard.

**PASS** — tenant binding and operational subscription enforced (audit scripts do not detect this guard).

### `/api/businesses/[id]`

| Method | Auth | Tenant | Subscription | Verdict |
|--------|------|--------|--------------|---------|
| GET | JWT + `authorize(settings, read)` | `requireTenantBusinessId(request, params.id)`; SQL uses `tenant.businessId` | **Not enforced** | **PASS** for P0 tenant/RBAC fix |
| PATCH | JWT + `authorize(settings, update)` | Same | **Not enforced** | **PASS** for P0 tenant/RBAC fix |

P0 target was cross-tenant business profile access. That vulnerability **fixed**. Subscription gate intentionally absent on settings read/update.

---

## Phase 3 — Tenant Isolation

Audit script `audit-business-id-classify.js` (fresh run):

| Classification | Count |
|----------------|------:|
| `requireTenantBusinessId` in route file | 67 |
| Raw query `business_id` only (no tenant guard in file) | **95** |
| Raw body `business_id` only | 1 |
| Path param business id | 8 |

**Note:** Routes wrapped by `withPremiumSubscriptionApi` call `requireTenantBusinessId` inside `with-business-api.ts`, not in the route file. Those are **SAFE** despite absent local grep hits.

### Confirmed UNSAFE routes (client-controlled tenant ID used in SQL/service without session validation)

| Route | Tenant source | Validation | Safe/Unsafe |
|-------|---------------|------------|-------------|
| `/api/features/enabled` | `searchParams.get('business_id')` | None; **no authentication** | **UNSAFE** |
| `/api/search` | `searchParams.get('business_id')` | JWT present; **no `requireTenantBusinessId`**; SQL `WHERE business_id = $1` | **UNSAFE** |
| `/api/whatsapp/dashboard/overview` | `searchParams.get('business_id')` | None; SQL on `whatsapp_conversations` | **UNSAFE** |
| `/api/whatsapp/dashboard/agents` | Query `business_id` (same pattern) | No tenant guard in handler | **UNSAFE** |
| `/api/items/search` | Query `business_id` | Middleware JWT only | **UNSAFE** |
| `/api/recurring-invoices` | Query `business_id` | No `requireTenantBusinessId` in file | **UNSAFE** |
| `/api/notifications` | Query `business_id` | No tenant guard in file | **UNSAFE** |
| `/api/invoice-templates` | Query `business_id` | No tenant guard in file | **UNSAFE** |
| `/api/settings/user-management` | Query `business_id` | No tenant guard in file | **UNSAFE** |
| `/api/commission-rules` | Query `business_id` | No tenant guard in file | **UNSAFE** |

Full raw-query-only list (95 routes): see `docs/BUSINESS_ID_RAW_QUERY_ONLY.json` (generated by audit script).

### Confirmed SAFE patterns

| Route / pattern | Tenant source | Validation | Safe/Unsafe |
|-----------------|---------------|------------|-------------|
| Premium modules using `withPremiumSubscriptionApi` | Query/body `business_id` | `requireTenantBusinessId` inside wrapper | **SAFE** |
| `/api/businesses/[id]` | `params.id` | `requireTenantBusinessId(request, params.id)` | **SAFE** |
| `/api/items/import` | Body `business_id` | `requireTenantBusinessId` | **SAFE** |
| `/api/gst/gstr2b/*` | Query/body `business_id` | `assertGstr2bApiAccess` → `requireTenantBusinessId` | **SAFE** |
| `/api/offline-sync/replay` | Body `business_id` | Compared to `getSessionScopedBusinessId()` → 403 on mismatch | **SAFE** (tenant); subscription not gated |

---

## Phase 4 — Premium Module Routes

Verification method: inspect each `app/api/{module}/**/route.ts` for `withPremiumSubscriptionApi`, `withWhatsAppPremiumApi`, or `assertGstr2bApiAccess`. For each route: Auth, Tenant, Subscription, Feature gates.

### Module summary

| Module | Routes | PASS | FAIL |
|--------|-------:|-----:|-----:|
| Work Orders | 1 | 1 | 0 |
| Ledger | 5 | 5 | 0 |
| Accounts | 6 | 6 | 0 |
| Budgets | 2 | 2 | 0 |
| TDS | 7 | 7 | 0 |
| GST (`app/api/gst`) | 13 | 13 | 0 |
| Bank Statements | 4 | 4 | 0 |
| WhatsApp Premium | 51 | 32 | **19** |
| **Total** | **89** | **70** | **19** |

### Work Orders, Ledger, Accounts, Budgets, TDS, Bank Statements — **PASS**

All handlers export via `withPremiumSubscriptionApi`, which chains:

`requireTenantBusinessId` → auth → `requireOperationalSubscription` → optional RBAC/feature in handler.

### GST — **PASS**

| Route group | Wrapper |
|-------------|---------|
| `charges`, `file`, `payment`, `revise`, `setoff`, `status`, `outstanding`, `audit-comparison`, `gstr3b/export` | `withPremiumSubscriptionApi` + `enforceAccess` / `assertReportAccess` in handler |
| `gstr2b/*` | `assertGstr2bApiAccess` (includes operational subscription + GST report + RBAC) |

Related but out of module prefix: `/api/gstin/lookup`, `/api/gstin/verify` — public GSTIN lookup, no tenant or subscription (not counted in module table).

### WhatsApp Premium — **FAIL** (19 routes)

Routes **without** `withWhatsAppPremiumApi` / subscription wrapper:

| Route | Auth | Tenant | Subscription | Feature | Result |
|-------|:----:|:------:|:--------------:|:-------:|--------|
| `/api/whatsapp/bot-rules/[id]/chains` | No | No | No | No | **FAIL** |
| `/api/whatsapp/conversations/[id]/linked-orders` | No | No | No | No | **FAIL** |
| `/api/whatsapp/dashboard/agents` | No | No | No | No | **FAIL** |
| `/api/whatsapp/dashboard/overview` | No | No | No | No | **FAIL** |
| `/api/whatsapp/disconnect` | Partial | No | No | No | **FAIL** |
| `/api/whatsapp/labels` | Partial | No | No | No | **FAIL** |
| `/api/whatsapp/labels/[id]` | Partial | No | No | No | **FAIL** |
| `/api/whatsapp/media` | Partial | No | No | No | **FAIL** |
| `/api/whatsapp/orders` | Partial | No | No | No | **FAIL** |
| `/api/whatsapp/orders/[id]/approve` | Partial | No | No | No | **FAIL** |
| `/api/whatsapp/orders/[id]/reject` | Partial | No | No | No | **FAIL** |
| `/api/whatsapp/qr` | Partial | No | No | No | **FAIL** |
| `/api/whatsapp/reminders` | Partial | No | No | No | **FAIL** |
| `/api/whatsapp/reminders/[type]` | Partial | No | No | No | **FAIL** |
| `/api/whatsapp/reminders/logs` | Partial | No | No | No | **FAIL** |
| `/api/whatsapp/send` | Partial | No | Partial (`hasWhatsAppBotAddon` only) | Partial | **FAIL** |
| `/api/whatsapp/send-bulk-reminders` | Partial | No | No | No | **FAIL** |
| `/api/whatsapp/status` | Partial | No | No | No | **FAIL** |
| `/api/whatsapp/webhook` | Signature only | N/A | No | No | **FAIL** (premium subscription N/A; no operational sub gate) |

32 other WhatsApp routes use `withWhatsAppPremiumApi` → **PASS**.

---

## Phase 5 — Automated Security Test Coverage

Test suite: `tests/security/` (4 files, 84 tests, all passing).

| Scenario | Coverage | Evidence |
|----------|----------|----------|
| No token | **Covered** | `premium-module-subscription.test.ts` + `NO_TOKEN_SCENARIO` → 401 |
| Free plan (operational active) | **Covered** | `subscription-scenarios.ts` id `freePlan` |
| Expired subscription | **Covered** | `require-operational-subscription.test.ts`, premium module tests |
| Expired trial | **Covered** | `subscription-scenarios.ts` id `expiredTrial` |
| Cancelled subscription | **Covered** | `subscription-scenarios.ts` id `cancelled` |
| Active subscription | **Covered** | `subscription-scenarios.ts` id `active` |
| Tenant read cross-tenant | **Partially covered** | 7 read routes in `PREMIUM_READ_ROUTES` only |
| Tenant update cross-tenant | **Partially covered** | 6 write routes in `TENANT_WRITE_ROUTES` |
| Tenant delete cross-tenant | **Partially covered** | 2 delete routes in `TENANT_DELETE_ROUTES` |
| Unmigrated WhatsApp routes | **Missing** | Not in test fixtures |
| Cron auth | **Missing** | No tests for `assertCronAuthorized` |
| Global unsafe routes (`/api/search`, `/api/features/enabled`) | **Missing** | Not in test fixtures |

---

## Phase 6 — Audit Script Execution (fresh outputs)

Executed 2026-06-06 on this workspace. Outputs written to `docs/SUBSCRIPTION_API_AUDIT.json`, `docs/EXPIRED_SUB_PENTEST.json`, and stdout from `audit-business-id-classify.js`.

### `audit-subscription-protection.js`

| Metric | Count |
|--------|------:|
| Route files | 587 |
| Handler rows | 725 |
| CRITICAL | **72** |
| HIGH | **229** |
| MEDIUM | 157 |
| LOW–MEDIUM | 65 |
| LOW | 202 |

**Limitation:** Script does not recognize `withPremiumSubscriptionApi`, `withWhatsAppPremiumApi`, `assertGstr2bApiAccess`, or `assertOperationalSubscription`. Many migrated premium routes are falsely flagged.

### `audit-business-id-classify.js`

| Metric | Count |
|--------|------:|
| Raw query `business_id` only | **95** |
| `requireTenantBusinessId` in route file | 67 |

### `pentest-expired-subscription.js`

| Metric | Count |
|--------|------:|
| Total exposed routes (no detectable sub gate) | **336** |

Top scored routes include cron endpoints (rely on `CRON_SECRET`, not subscription), GSTR-2B (protected in source via guard), and `/api/offline-sync/replay` (auth + tenant match but **no** `requireOperationalSubscription`).

---

## 1. Critical Findings Remaining

| # | Finding | Evidence |
|---|---------|----------|
| C1 | **72 CRITICAL** subscription-gate gaps per audit script (paid-feature mutations without detectable server-side subscription check) | `docs/SUBSCRIPTION_API_AUDIT.json` severity counts |
| C2 | **`/api/features/enabled` — unauthenticated tenant data exposure** | No auth; `searchParams.get('business_id')` drives `getAllFeatureAccessForBusiness(businessId)` |
| C3 | **19 WhatsApp premium routes lack operational subscription enforcement** | No `withWhatsAppPremiumApi`; e.g. `dashboard/overview` uses raw query `business_id` in SQL with no auth |

---

## 2. High Findings Remaining

| # | Finding | Evidence |
|---|---------|----------|
| H1 | **229 HIGH** findings per audit script (mutations/read endpoints without subscription enforcement) | `docs/SUBSCRIPTION_API_AUDIT.json` |
| H2 | **`/api/search` — cross-tenant read IDOR** | Authenticated user can pass arbitrary `business_id`; used directly in SQL (`app/api/search/route.ts` lines 23–47) |
| H3 | **95 routes with raw query `business_id` and no in-file tenant guard** | `audit-business-id-classify.js` output |
| H4 | **`/api/offline-sync/replay` — expired subscription can replay mutations** | Auth + tenant scope check present; no `requireOperationalSubscription` or `enforceAccess` |
| H5 | **`/api/whatsapp/send` — client `business_id`, addon-only gate, no operational subscription or tenant binding** | `hasWhatsAppBotAddon(business_id)` only; no `requireTenantBusinessId` |

---

## 3. Medium Findings Remaining

| # | Finding | Evidence |
|---|---------|----------|
| M1 | **157 MEDIUM** audit findings (reads without subscription check, partial auth) | Audit JSON |
| M2 | **`/api/businesses/[id]` — no operational subscription on GET/PATCH** | Tenant/RBAC fixed; subscription not required for settings |
| M3 | **Audit scripts produce false negatives on migrated premium routes** | Regex patterns omit `withPremiumSubscriptionApi` / `assertGstr2bApiAccess` |
| M4 | **336 routes flagged by pentest script as subscription-exposed** | Includes cron (CRON_SECRET-protected) and false positives on guarded routes |

---

## 4. Premium Routes Missing Subscription Protection

**19 routes** under `app/api/whatsapp/` (listed in Phase 4). All other scoped premium modules (Work Orders, Ledger, Accounts, Budgets, TDS, GST, Bank Statements) enforce operational subscription via wrappers or `assertGstr2bApiAccess`.

---

## 5. Tenant Isolation Vulnerabilities

Confirmed in source (not exhaustive; 95 raw-query routes flagged):

- `/api/features/enabled` — unauthenticated cross-tenant feature matrix read
- `/api/search` — authenticated cross-tenant search across invoices, customers, items, suppliers
- `/api/whatsapp/dashboard/overview` — unauthenticated cross-tenant WhatsApp CRM metrics
- Additional routes in `docs/BUSINESS_ID_RAW_QUERY_ONLY.json` using client `business_id` in queries without `requireTenantBusinessId` or session comparison

---

## 6. Dead Security Code

| Item | Status |
|------|--------|
| `requireOperationalSubscription()` | **Live** — used by wrapper and GSTR-2B guard |
| `withBusinessApi()` | **Live** — used by `premium-module-api.ts` |
| `lib/security/examples.ts` | **Non-production** — reference patterns only; no route imports |

No evidence that the core security foundation is dead code.

---

## 7. Test Coverage Gaps

| Area | Status |
|------|--------|
| Subscription deny/allow matrix (unit) | **Covered** |
| Premium wrapper integration (representative routes) | **Covered** (7 modules via `PREMIUM_READ_ROUTES`; WhatsApp not included) |
| Cross-tenant read/write/delete | **Partially covered** (15 premium probe routes only) |
| P0 cron auth (`assertCronAuthorized`) | **Missing** |
| Unmigrated WhatsApp routes | **Missing** |
| Global IDOR routes (`/api/search`, `/api/features/enabled`) | **Missing** |
| Full route inventory (587 files) | **Missing** |

---

## Appendix — P0 Route Verdicts

| Area | Verdict |
|------|---------|
| `/api/cron/*` auth | **PASS** |
| `/api/items/import` | **PASS** |
| `/api/gst/gstr2b/*` | **PASS** |
| `/api/businesses/[id]` tenant/RBAC | **PASS** |

---

*Report generated from source verification and audit scripts executed 2026-06-06. No remediation recommendations included per audit scope.*
