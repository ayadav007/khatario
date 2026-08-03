# Revenue Leakage Closure Report

**Date:** 2026-06-23  
**Scope:** Hardening Pass 2 + Pass 1 entitlement fixes  
**Test environment:** Local dev `http://localhost:3101` with Postgres personas

---

## Executive summary

| Area | Pass 1 | Pass 2 | Status |
|------|--------|--------|--------|
| Direct module enable (`POST /api/modules`) | Fixed | — | **Closed** |
| Tenant plan assignment (`POST /api/subscriptions/current`) | Fixed | — | **Closed** |
| Billing list APIs | Fixed | Extended via `authorize()` | **Closed** |
| Billing detail/search/dashboard/estimates | Open | **Closed** (centralized gate) | **Closed** |
| HR / payroll / recruitment / attendance | Open | **Closed** (centralized gate) | **Closed** |
| WhatsApp settings leak | Open | Fixed (auth + connect gate) | **Closed** |
| Production readiness | Not ready | **Staging-ready** with caveats below | See §6 |

**Verdict:** Revenue leakage from cross-module API access is **closed** for all routes using `authorize()`. Khatario is **ready for staging production testing**. Full production go-live should wait for Razorpay checkout verification on staging and the remaining low-priority items in §6.

---

## 1. Routes modified (Pass 2)

### Central enforcement (covers ~150+ API handlers)

| File | Change | Routes affected |
|------|--------|-----------------|
| `lib/authorization.ts` | `assertModuleAccess` for all users (incl. primary admin) before RBAC | Every handler calling `authorize()` with billing/hr/connect RBAC modules |
| `lib/rbac-permission-catalog.ts` | `dashboard` → `billing`; added `resolvePlatformModuleForAuthModule()` | Dashboard KPIs, reports RBAC modules, all catalog-mapped modules |

**Automatically gated via `authorize()` (non-exhaustive):**

- **HR:** `/api/employees/**`, `/api/hr/**` (recruitment, onboarding), payroll, attendance, leave
- **Billing:** `/api/invoices/**`, `/api/customers/**`, `/api/items/**`, `/api/purchases/**`, `/api/estimates`, suppliers, payments, expenses, reports (RBAC module), journal, warehouses, etc.
- **Dashboard:** `/api/dashboard/**` (all KPI/chart endpoints)
- **Connect:** RBAC `whatsapp` module routes using `authorize()`

### Explicit route patches (no / weak `authorize()` before)

| File | Methods | Gate |
|------|---------|------|
| `app/api/items/search/route.ts` | GET | `authorize(items, read)` → billing module |
| `app/api/invoices/next-number/route.ts` | GET | `authorize(invoices, read)` → billing module |
| `app/api/estimates/[id]/convert/route.ts` | POST | `authorize` + `enforceAccess(ESTIMATES_QUOTATIONS)` |
| `app/api/settings/whatsapp-bot/route.ts` | GET, PATCH | `authorize(whatsapp)` → connect module |
| `lib/security/guard-platform-module.ts` | — | Helper for future unauthenticated routes |

### Pass 1 (still in effect)

| File | Gate |
|------|------|
| `app/api/modules/route.ts` | POST → 403 `MODULE_REQUIRES_CHECKOUT` |
| `app/api/invoices/route.ts` | GET list + module gate |
| `app/api/customers/route.ts` | GET list + module gate |
| `app/api/items/route.ts` | GET list + module gate |
| `app/api/purchases/route.ts` | GET list + module gate |
| `app/api/subscriptions/current/route.ts` | POST → 403 |

---

## 2. Before / after behavior

| Persona | Endpoint | Before | After |
|---------|----------|--------|-------|
| Connect-only | `GET /api/invoices` | 200 `{ invoices: [] }` | **403** `FEATURE_NOT_IN_PLAN` |
| Connect-only | `GET /api/invoices/[id]` | 200 (if id known) | **403** |
| Connect-only | `GET /api/dashboard/receivables` | 200 financial data | **403** |
| Connect-only | `GET /api/employees` | 200 (empty or data) | **403** |
| Connect-only | `GET /api/hr/recruitment/jobs` | 200 | **403** |
| Billing-only | `GET /api/employees` | 200 | **403** |
| HR-only | `GET /api/customers` | 200 | **403** |
| HR-only | `GET /api/items/search?q=x` | 200 | **403** |
| Billing (entitled) | Billing APIs | 200 | **200** ✓ |
| HR (entitled) | HR APIs | 200 | **200** ✓ |
| Any tenant | `POST /api/modules` | 200 enabled Connect | **403** `MODULE_REQUIRES_CHECKOUT` |
| Any tenant | `POST /api/subscriptions/current` | 200 assigned enterprise | **403** `SUBSCRIPTION_ASSIGNMENT_FORBIDDEN` |

Primary admins are **no longer exempt** from platform module gates.

---

## 3. Test coverage

### Unit tests

| File | Tests |
|------|-------|
| `tests/lib/platform-module-auth-gate.test.ts` | 5 passed — RBAC→platform module mapping |

### E2E / API tests

| File | Tests | Result |
|------|-------|--------|
| `e2e/entitlement-enforcement.spec.ts` | 6 | **6/6 passed** |
| `e2e/entitlement-hardening-pass2.spec.ts` | 7 | **7/7 passed** |

**Pass 2 matrix:**

- Connect → 10 billing endpoints blocked (403)
- Connect → 6 HR endpoints blocked (403)
- Billing → 6 HR endpoints blocked (403)
- HR → 10 billing endpoints blocked (403)
- Entitled billing → 5 endpoints return 200
- Entitled HR → 3 endpoints return 200
- Browser UI upsell for Connect on `/invoices` and `/employees`

Run:

```powershell
$env:PLAYWRIGHT_SKIP_WEBSERVER="1"
$env:PLAYWRIGHT_BASE_URL="http://localhost:3101"
$env:E2E_DISABLE_RATE_LIMIT="true"
npx playwright test e2e/entitlement-hardening-pass2.spec.ts e2e/entitlement-enforcement.spec.ts
npm test -- tests/lib/platform-module-auth-gate.test.ts
```

---

## 4. Browser evidence

| Screenshot | Description |
|------------|-------------|
| `e2e/evidence/pass2-connect-billing-blocked.png` | Connect user navigates to `/invoices` → upsell redirect |
| `e2e/evidence/pass2-connect-hr-blocked.png` | Connect user navigates to `/employees` → upsell redirect |
| `e2e/evidence/*.png` (Pass 1) | Full subscription audit scenarios A–F |

---

## 5. Server-side confirmation

- **Single enforcement point:** `authorize()` → `assertModuleAccess()` using `PERMISSION_MODULE_PLATFORM`
- **Primary admin bypass removed** for module entitlement (RBAC bypass retained after module check)
- **Defense in depth:** List routes retain explicit `requirePlatformModule()` from Pass 1
- **Frontend guards:** UI upsells remain; not relied upon for security
- **Payment paths:** Module enable only via checkout webhook or validated ₹0 upgrade

---

## 6. Remaining risks (ranked)

| Severity | Risk | Notes |
|----------|------|-------|
| **Medium** | Routes that never call `authorize()` | Public/token routes (invoice public link, webhooks), cron, offline catalog — intentional |
| **Medium** | Paid checkout not E2E-tested locally | Razorpay not configured in dev; verify on staging before go-live |
| **Medium** | Subscription mutation RBAC | `checkout`/`upgrade` use tenant binding only; any logged-in user can initiate — consider `authorize(settings)` |
| **Low** | `reports/label-print-log` | RBAC only; report tier not checked |
| **Low** | Employee portal ESS APIs | Separate cookie auth; out of tenant module scope |
| **Low** | Feature-level gates on some GETs | e.g. estimates GET has billing module but not `ESTIMATES_QUOTATIONS` feature on GET (POST has it) |

---

## 7. Production readiness checklist

| Criterion | Status |
|-----------|--------|
| Cross-module API leakage closed | ✅ |
| Direct module/plan assignment blocked | ✅ |
| Automated regression tests | ✅ |
| Browser upsell flows verified | ✅ |
| Staging Razorpay checkout for paid modules | ⏳ Manual QA on staging |
| nginx / PM2 deploy | ⏳ Per `docs/SERVER_INFRASTRUCTURE.md` |
| Production vhost (`app.khatario.com`) | ❌ Not live yet |

**Recommendation:** Deploy to **staging.khatario.com**, run paid module checkout + addon purchase smoke tests, then proceed to production go-live.

---

## Architecture note

```
API Request
    → middleware (JWT session)
    → route handler
        → authorize(userId, rbacModule, action, { businessId })
            → assertModuleAccess (billing|hr|connect)  ← NEW Pass 2
            → assertFeatureAccess (HR plan features)
            → primary admin RBAC bypass
            → RBAC permission check
            → PBAC policies
        → business logic
```

This ensures entitlement enforcement is **mandatory and centralized**, not duplicated per route.
