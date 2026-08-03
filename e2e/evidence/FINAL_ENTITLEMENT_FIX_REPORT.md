# Entitlement Enforcement Fix — Final Report

**Date:** 2026-06-23  
**Environment tested:** `http://localhost:3101` (local dev + Postgres)

---

## 1. Root cause analysis

### Issue 1 — `POST /api/modules` enabled Connect without payment

| Finding | Detail |
|---------|--------|
| **Handler** | `app/api/modules/route.ts` |
| **Root cause** | POST only checked RBAC (`settings:create`), then called `enableBusinessModule()` + `upsertModuleSubscription()` with `MODULE_ADD_CONFIG.connect.status = 'active'` — no payment or checkout verification |
| **Client trust** | Products UI (`settings/products`) called this API directly on "Add Connect/Billing/HR" |
| **Other modules** | Same path affected **billing**, **hr**, and **connect** — any module could be enabled for free via direct API |

**Fix:** POST now returns **403** with code `MODULE_REQUIRES_CHECKOUT` and points to `/api/subscriptions/checkout` or `/api/subscriptions/upgrade`. Module enablement happens only inside `applyModuleSubscriptionPlanChange()` after checkout/webhook or ₹0 upgrade.

### Issue 2 — `GET /api/invoices` returned 200 for Connect-only users

| Finding | Detail |
|---------|--------|
| **Handler** | `app/api/invoices/route.ts` |
| **Root cause** | Only `authorize(userId, 'invoices', 'read')` — no check that the business has the **billing** module enabled/subscribed |
| **Impact** | Connect-only primary admins with invoice RBAC could read billing API (empty list, but full endpoint surface) |
| **UI vs API** | Route guard redirected UI to upsell; API was unguarded |

**Fix:** Added `requirePlatformModule(businessId, 'billing', 'invoices')` before query execution. Same pattern applied to list GET on `customers`, `items`, `purchases`.

### Issue 3 — `POST /api/subscriptions/current` plan assignment

Tenants could POST `plan_id: enterprise` with `status: active` without payment. Now returns **403** `SUBSCRIPTION_ASSIGNMENT_FORBIDDEN`.

---

## 2. Code changes

| File | Change |
|------|--------|
| `app/api/modules/route.ts` | Block direct enablement; 403 `MODULE_REQUIRES_CHECKOUT` |
| `lib/subscription/module-add-flow.ts` | Checkout redirect constants |
| `lib/subscription/apply-module-plan-change.ts` | Calls `enableBusinessModule()` after paid/free plan apply |
| `lib/security/require-platform-module.ts` | **New** server-side module gate helper |
| `app/api/invoices/route.ts` | Billing module gate on GET |
| `app/api/customers/route.ts` | Billing module gate on GET |
| `app/api/items/route.ts` | Billing module gate on GET |
| `app/api/purchases/route.ts` | Billing module gate on GET |
| `app/api/subscriptions/current/route.ts` | Block tenant POST plan assignment |
| `app/(app)/settings/products/page.tsx` | Add product → `startPlanUpgrade` (checkout) not `POST /api/modules` |
| `e2e/entitlement-enforcement.spec.ts` | **New** automated entitlement tests |
| `e2e/subscription-evidence.spec.ts` | Updated expectations for fixed behavior |

---

## 3. Test evidence

### Automated (Playwright + Postgres personas)

**`e2e/entitlement-enforcement.spec.ts` — 6/6 passed**

| Test | Result |
|------|--------|
| POST `/api/modules` (connect) | **403** `MODULE_REQUIRES_CHECKOUT` |
| Connect-only GET `/api/invoices` | **403** `FEATURE_NOT_IN_PLAN` |
| Billing user GET `/api/invoices` | **200** |
| POST `/api/subscriptions/current` (enterprise) | **403** `SUBSCRIPTION_ASSIGNMENT_FORBIDDEN` |
| Manipulated `module_key: not_a_module` | **400** |
| Upgrade API (`free` plan + billing module) → invoices | **200** after entitlement |

**`e2e/subscription-evidence.spec.ts` — 7/7 passed** (updated scenarios D, E)

- Connect → Billing UI upsell + API **403**
- Revenue leakage test E: module POST **403**, plan assign **403**

Run command:

```powershell
$env:PLAYWRIGHT_SKIP_WEBSERVER="1"
$env:PLAYWRIGHT_BASE_URL="http://localhost:3101"
$env:E2E_DISABLE_RATE_LIMIT="true"
npx playwright test e2e/entitlement-enforcement.spec.ts e2e/subscription-evidence.spec.ts
```

---

## 4. APIs checked (entitlement audit)

Full tables: `e2e/evidence/ENTITLEMENT_API_AUDIT.md`

| Area | Routes reviewed | Module gate status |
|------|-----------------|-------------------|
| **modules** | GET/POST `/api/modules` | POST blocked ✓ |
| **subscriptions** | checkout, upgrade, current, addons | current POST blocked ✓ |
| **invoices** | list GET | gated ✓; detail/PDF routes still RBAC-only |
| **customers** | list GET | gated ✓; `[id]` routes RBAC-only |
| **items** | list GET | gated ✓; search/detail RBAC-only |
| **purchases** | list GET | gated ✓; detail RBAC-only |
| **estimates** | GET | **Not gated** — High risk |
| **dashboard** | 14+ KPI GETs | **Not gated** — High risk |
| **reports** | ~74 routes | `assertReportAccess` ✓ (mostly) |
| **employees/payroll** | all HR routes | RBAC only — **no `hr` module gate** |
| **whatsapp** | premium/base wrappers | Subscription + addon gates ✓ |
| **settings** | mixed | RBAC only; `whatsapp-bot` unauthenticated risk |
| **exports** | GST/WhatsApp | Feature/report gates ✓ |

---

## 5. Server-side confirmation

- Module activation: **server-only** via `applyModuleSubscriptionPlanChange` → `enableBusinessModule`
- Direct `POST /api/modules`: **cannot** enable modules (403)
- Billing list APIs: **`assertModuleAccess`** via `requirePlatformModule` before DB reads
- UI route guards remain defense-in-depth; **API enforcement is mandatory** on patched routes
- ₹0 upgrades use `/api/subscriptions/upgrade` with amount validation; paid plans require checkout

---

## 6. Remaining risks (prioritized)

| Priority | Risk | Recommendation |
|----------|------|----------------|
| **High** | Billing detail routes (`/api/invoices/[id]`, PDF, preview, items/search) — RBAC only | Add `requirePlatformModule('billing')` to all billing read routes |
| **High** | HR/payroll APIs — no `assertModuleAccess('hr')` | Add HR module gate to all `employees/**` routes |
| **High** | Dashboard KPI GETs expose financial data without billing module | Gate dashboard routes |
| **High** | `GET /api/estimates` ungated; convert route weak auth | Mirror POST feature gates on GET |
| **Medium** | `settings/whatsapp-bot` — tenant binding without auth | Align with WhatsApp API wrappers |
| **Medium** | Subscription mutation routes lack RBAC | Add `authorize(settings)` on checkout/upgrade |
| **Low** | Reports mostly protected via `assertReportAccess` | Fix `reports/label-print-log` |

---

## Summary

Both reported revenue/security issues are **fixed and verified** with automated tests. Entitlement enforcement is **server-side** for module activation and primary billing list APIs. A broader audit identified **systemic gaps** on billing detail routes, all HR APIs, dashboard, and estimates — documented for follow-up hardening.
