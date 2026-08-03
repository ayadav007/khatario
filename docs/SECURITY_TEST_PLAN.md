# Security Test Plan

**Date:** 2026-06-06  
**Framework:** Jest (`npm test`) — Node environment, `tests/security/**`  
**Scope:** Premium module API gates (subscription + tenant isolation). No production code changes.

---

## Objectives

1. Verify **subscription scenarios** block or allow premium API access correctly.
2. Verify **tenant isolation** — Business A cannot read/update/delete Business B data via `business_id` tampering.
3. Verify tests **fail when protections are removed** (regression hooks).

---

## Test layout

```
tests/security/
  fixtures/
    identities.ts              # BUSINESS_A, BUSINESS_B, USER_A, …
    subscription-scenarios.ts  # 6 subscription states + no-token case
    premium-routes.ts          # Route matrix per module
  helpers/
    api-request.ts             # NextRequest builders with JWT headers
    mock-deps.ts               # Shared jest mocks (subscription, DB, RBAC)
    route-invoker.ts           # Dynamic import + invoke route handler
    response.ts                # JSON response helpers
  require-operational-subscription.test.ts
  with-premium-subscription-api.test.ts
  premium-module-subscription.test.ts
  tenant-isolation.test.ts
```

---

## Subscription scenarios

| # | Scenario | Fixture | Expected gate |
|---|----------|---------|---------------|
| 1 | No token | No `x-authenticated-*` headers | **401** |
| 2 | Free plan | `status: active`, `plan_id: free` | **Pass** (200 / not 403) |
| 3 | Expired subscription | `getBusinessSubscription → null` | **403** `NO_SUBSCRIPTION` |
| 4 | Expired trial | `trial` + `checkTrialExpiry.isExpired` | **403** `TRIAL_EXPIRED` |
| 5 | Cancelled subscription | `status: cancelled` | **403** `SUBSCRIPTION_CANCELLED` |
| 6 | Active subscription | `status: active`, `plan_id: pro` | **Pass** |

**Suspended** (platform): **403** `BUSINESS_SUSPENDED` — covered in primitive tests.

---

## Tenant isolation scenarios

| # | Scenario | Method | Probe |
|---|----------|--------|-------|
| 1 | Business A reads Business B | GET | All 7 premium read routes with `business_id=B`, session=A |
| 2 | Business A updates Business B | POST/PATCH/PUT | Work orders, budgets, accounts, TDS, GST payment, bank import |
| 3 | Business A deletes Business B | DELETE | Accounts `[id]`, TDS categories `[id]` |

Expected: **403** — `Business ID does not match your session`

---

## Premium modules under test

| Module | Read route | Write/delete probes |
|--------|------------|---------------------|
| Work Orders | `GET /api/work-orders` | `POST /api/work-orders` |
| Ledger | `GET /api/ledger` | — |
| Accounts | `GET /api/accounts` | `PATCH/DELETE /api/accounts/[id]` |
| Budgets | `GET /api/budgets` | `POST /api/budgets` |
| TDS | `GET /api/tds/categories` | `PUT/DELETE /api/tds/categories/[id]` |
| GST | `GET /api/gst/outstanding` | `POST /api/gst/payment` |
| Bank Statements | `GET /api/bank-statements/unreconciled` | `POST /api/bank-statements/import` |

GSTR-2B routes use `assertGstr2bApiAccess` (includes `requireOperationalSubscription`); covered indirectly via primitive + wrapper tests.

WhatsApp premium routes use `withWhatsAppPremiumApi`; extend matrix by duplicating `PREMIUM_READ_ROUTES` entries if needed.

---

## Mocks (no database)

| Dependency | Mock behavior |
|------------|---------------|
| `getBusinessSubscription` | Driven by `applySubscriptionScenario()` |
| `isBusinessPlatformSuspended` | `true` for suspended scenario |
| `checkTrialExpiry` | Expired for trial scenario |
| `assertSessionValidForCookieAuth` | Always passes |
| `authorize` / `enforceAccess` | Resolve (RBAC not under test) |
| `queryRows` / `queryOne` / `getPool` | Empty / stub rows |

---

## Running tests

```bash
# All security tests
npm test -- tests/security

# Single file
npm test -- tests/security/premium-module-subscription.test.ts

# Watch mode
npm run test:watch -- tests/security
```

---

## Protection regression (fail if gate removed)

Each suite includes tests that **spy on** `requireOperationalSubscription` or `requireTenantBusinessId` and simulate removed protections:

| Suite | Simulated removal | Expected without protection |
|-------|-------------------|---------------------------|
| `with-premium-subscription-api.test.ts` | Mock `requireOperationalSubscription` → resolve | Handler runs on expired sub (**200**) |
| `tenant-isolation.test.ts` | Mock `requireTenantBusinessId` → foreign tenant | Status **≠ 403** |
| `require-operational-subscription.test.ts` | Mock active subscription on null row | Resolves (would bypass expired check) |

**Manual verification:** Comment out `requireOperationalSubscription` in `lib/security/with-business-api.ts` — `npm test -- tests/security` should fail on expired/cancelled/trial scenarios.

---

## Success criteria checklist

- [ ] `npm test -- tests/security` passes on current `main` (**84 tests**)
- [ ] No-token → 401 on all premium read routes
- [ ] Expired / cancelled / expired trial → 403 on all premium read routes
- [ ] Free + active → pass subscription gate (not 403 subscription codes)
- [ ] Cross-tenant read/write/delete → 403
- [ ] Regression spies prove tests detect bypassed gates

---

## Out of scope

- Playwright E2E against staging (optional follow-up with `E2E_TEST_PHONE`)
- Non-premium routes (invoices, customers, …)
- RBAC matrix / plan feature registry (PBAC tests live in `tests/pbac/`)
