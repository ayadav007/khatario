# Final Security Sign-Off

**Date:** 2026-06-06  
**Auditor role:** Verification only (sign-off exercise)  
**Scripts run:**

| Script | Output artifact |
|--------|-----------------|
| `node scripts/audit-subscription-protection.js` | `docs/SUBSCRIPTION_API_AUDIT.json` |
| `node scripts/audit-business-id-classify.js` | `docs/BUSINESS_ID_RAW_QUERY_ONLY.json`, `docs/BUSINESS_ID_RAW_BODY_ONLY.json`, `docs/BUSINESS_ID_PATH_PARAM.json` |
| `node scripts/pentest-expired-subscription.js` | `docs/EXPIRED_SUB_PENTEST.json` |

---

## Verdict

### **SIGN-OFF: NOT APPROVED**

Pass criteria require **Critical = 0** and **High = 0**. Automated audits report:

| Severity | Handler-level count (`audit-subscription-protection.js`) | Pass? |
|----------|----------------------------------------------------------|-------|
| **Critical** | **72** | **FAIL** |
| **High** | **229** | **FAIL** |
| Medium | 222 | — |

Additional exposure map: **336** routes flagged by `pentest-expired-subscription.js` as reachable with expired subscription (no legacy subscription regex match).

**Security remediation is not complete under the stated pass criteria.**

---

## 1. Remaining Critical findings

**72 handler rows** across **40 unique route paths** (`subRequired: No` + paid-feature / mutation severity in subscription audit).

Representative Critical routes:

| Route | File | Audit reason |
|-------|------|--------------|
| `POST /api/employees/attendance/check-in` | `app/api/employees/attendance/check-in/route.ts` | Paid-feature route, no server-side subscription check |
| `POST /api/employees/attendance/check-out` | `app/api/employees/attendance/check-out/route.ts` | Same |
| `POST /api/employees/salary/payments` | `app/api/employees/salary/payments/route.ts` | Same |
| `POST /api/gst/gstr2b/import` | `app/api/gst/gstr2b/import/route.ts` | Same (static scan; see note below) |
| `GET/POST /api/gst/gstr2b/reconcile` | `app/api/gst/gstr2b/reconcile/route.ts` | Same |
| `GET/POST /api/gst/gstr2b/decision` | `app/api/gst/gstr2b/decision/route.ts` | Same |
| `POST /api/offline-sync/replay` | `app/api/offline-sync/replay/route.ts` | Expired-sub pentest score 130 |
| `GET/POST /api/invoices/extract` | `app/api/invoices/extract/route.ts` | Export path, no subscription regex |
| `POST /api/items/[id]/serials/bulk-import` | `app/api/items/[id]/serials/bulk-import/route.ts` | Bulk import, no subscription regex |
| `GET/POST /api/journal-entries/templates` | `app/api/journal-entries/templates/route.ts` | Paid ledger feature hint |
| `POST /api/work-orders` | `app/api/work-orders/route.ts` | Paid-feature hint (mutation) |

**Pentest top Critical-class exposures (score ≥ 120):** all `/api/cron/*` job endpoints (middleware public prefix; relies on `CRON_SECRET` in handler), `/api/offline-sync/replay`, GSTR-2B import/reconcile/decision, invoice OCR extract, serial bulk-import, tools export.

Full Critical route list: see `criticalRoutes` in `docs/SUBSCRIPTION_API_AUDIT.json` rows where `risk` contains `CRITICAL` (40 unique paths).

---

## 2. Remaining High findings

**229 handler rows** across **145 unique route paths**.

Common High patterns from subscription audit:

- **`HIGH — mutation without subscription enforcement`** — POST/PATCH/PUT/DELETE with JWT middleware only (examples: `/api/bank/import`, `/api/bank/reconciliation/*`, `/api/bank-accounts`, `/api/attendance/*`, `/api/custom-fields`, `/api/delivery-challans`, `/api/credit-approvals/*`).
- **`HIGH — paid-feature route without server-side subscription check`** — GET on premium paths (examples: `/api/cloud-storage/google/auth`, `/api/commission-rules`, `/api/ledger/*` helpers not matching legacy regex, many `/api/reports/*` reads).
- **`HIGH — mutation without authorize/enforceAccess in handler`** — partial auth (examples: numerous settings and operational routes).

Pentest adds **107+ High-category** entries (inventory, items, customers, analytics, settings) among **336** total exposed routes.

Sample High routes (first 20 from audit sample):

- `/api/attendance/logout`, `/api/attendance/send-otp`, `/api/attendance/verify-otp`, `/api/attendance/verify-session`
- `/api/bank/import`, `/api/bank/import/confirm`, `/api/bank/reconciliation/*` (7 mutation endpoints)
- `/api/bank-accounts` (GET/POST/PUT/DELETE)
- `/api/bookings/create`
- `/api/business/[id]` PATCH, `/api/businesses/[id]` GET/PATCH
- `/api/cloud-storage/google/auth`, `/api/cloud-storage/google/callback`
- `/api/commission-rules`, `/api/commission-rules/[id]`
- `/api/credit-approvals/*`
- `/api/currencies`, `/api/custom-fields`, `/api/custom-fields/[id]`

Full list: filter `docs/SUBSCRIPTION_API_AUDIT.json` → `rows` where `risk` contains `HIGH`.

---

## 3. Remaining Medium findings

**222 handler rows** across **185 unique route paths**.

Typical Medium patterns:

- **`MEDIUM — read endpoint without subscription check`**
- **`MEDIUM — handler lacks explicit auth/RBAC`**
- **`MEDIUM — reads business_id from client; middleware JWT present but no RBAC`**
- **`MEDIUM — mutation may bypass usage limits`** (core routes without `checkLimit`)

Examples: `/api/activity-logs`, `/api/badges/counts`, `/api/search`, `/api/features/enabled`, `/api/dashboard/*`, many read-only list endpoints.

---

## 4. Routes still missing subscription checks

Per `audit-subscription-protection.js` (handlers with `subRequired: No`, excluding middleware-public admin/cron/public/auth):

| Metric | Count |
|--------|------:|
| Handlers missing subscription gate | **301** |
| Handlers with full subscription gate (`subRequired: Yes`) | 215 |
| Partial subscription / core-only | 111 |

**301 handlers** rely on JWT middleware alone or have no `assertFeatureAccess` / `assertReportAccess` / `enforceAccess` / legacy regex match.

Notable gaps still flagged after recent premium-module work (static scan does not detect `withPremiumSubscriptionApi`, `requireOperationalSubscription`, `assertGstr2bApiAccess`, `assertCronAuthorized`):

- `/api/work-orders`, `/api/budgets`, `/api/tds/*`, `/api/bank-statements/*`, `/api/accounts/*`, `/api/ledger/*` — wrapped in code but **absent from audit regex**
- `/api/gst/gstr2b/*` — guarded via `assertGstr2bApiAccess` but flagged (no legacy match)
- `/api/cron/*` — guarded via `assertCronAuthorized` but flagged (`hasSub: false`, `hasAuth: false`)
- Un migrated modules: HR/payroll, bank reconciliation (`/api/bank/*`), offline replay, reports, search, features/enabled, recurring invoices, etc.

Reference: `docs/SUBSCRIPTION_API_AUDIT.json` → filter `subRequired === "No"`.

Pentest companion: **`docs/EXPIRED_SUB_PENTEST.json`** → `totalExposed: 336`.

---

## 5. Routes still vulnerable to tenant isolation

Per `audit-business-id-classify.js`:

| Classification | Count | Risk |
|----------------|------:|------|
| **`rawQueryOnly`** — `searchParams.get('business_id')` without `getBusinessIdFromRequest` / tenant guard | **95** | Client-controlled tenant; IDOR if session not enforced elsewhere |
| **`rawBodyOnly`** — body `business_id` only | **1** | Same |
| **`helperOnly`** — `getBusinessIdFromRequest` (JWT wins when present) | 169 | Lower risk when middleware JWT always set |
| **`mixed`** — helper + raw query/body | 11 | Review per route |
| **`tenantGuard`** — `requireTenantBusinessId` / `getSessionScopedBusinessId` | 67 | Hardened |
| **`pathBizId`** — business id in path segment, no session guard in file | **8** | Path-based IDOR risk |

**95 routes** in `docs/BUSINESS_ID_RAW_QUERY_ONLY.json` including:

- `/api/search`, `/api/features/enabled`, `/api/recurring-invoices`
- `/api/gst/gstr2b/decision`, `/api/gst/gstr2b/export`, `/api/gst/gstr2b/reconcile` (query `business_id`; guarded in handler but not in classify regex)
- `/api/backup/history`, `/api/cloud-storage/google/*`
- `/api/journal-entries/templates`, `/api/opening-balances`, `/api/settings/*` (many)
- Cron routes using query `business_id` for scoped jobs

**1 route** in `docs/BUSINESS_ID_RAW_BODY_ONLY.json`.

**8 path-param routes** in `docs/BUSINESS_ID_PATH_PARAM.json` (e.g. `/api/businesses/[id]` — P0 fix applied; classify script does not detect wrapper).

---

## Audit tooling note (verification scope only)

Static scripts match **legacy** patterns (`assertFeatureAccess`, `enforceAccess`, `authorize`, etc.). They do **not** recognize:

- `withPremiumSubscriptionApi` / `withWhatsAppPremiumApi`
- `requireOperationalSubscription`
- `assertGstr2bApiAccess`
- `assertCronAuthorized`

Routes remediated with these wrappers may still appear in audit output. **Pass/fail for this sign-off uses script output as specified**, not manual reclassification.

---

## Pass criteria checklist

| Criterion | Required | Actual | Result |
|-----------|----------|--------|--------|
| Critical findings | 0 | **72** | **FAIL** |
| High findings | 0 | **229** | **FAIL** |

---

## Conclusion

**Security remediation is not complete.** Critical and High findings remain in all three automated audits. Sign-off is **withheld** until Critical = 0 and High = 0 per the audit scripts.

**Stopped** — no further scope expansion per instructions.
