# Local QA — Admin plans & user plan switch

**Date:** 2026-06-26  
**Environment:** `http://localhost:3000` (dev server + local Postgres)  
**Deploy:** Not performed (per user preference)

---

## Summary

| Area | Result |
|------|--------|
| Downgrade preview API (`trial → free`) | **PASS** (200 + warnings) |
| Invalid downgrade (`free → trial`) | **FIXED** — was 500, now **400** |
| Admin limit override → `check-limit` | **PASS** |
| Admin feature toggle → API 403 | **PASS** |
| `enabled_features` labels from registry | **PASS** |
| Free upgrade API + module plan | **PASS** (1 flaky retry on `/api/invoices` timeout) |
| Downgrade preview e2e | **PASS** |
| Change Plan modal UI | **PASS** |
| Paid upgrade → checkout guard | **PASS** (402/503, plan unchanged) |
| All 28 limits vs admin matrix | **PASS** |
| HR limits scoping | **PASS** (1 skipped where N/A) |
| `resolve-plan-limit` unit tests | **PASS** (4/4) |

**Verdict:** Local confidence is **high** for plan switch + admin enforcement. Safe to deploy when you choose; re-run this suite after deploy on staging for confirmation only.

---

## Fixes applied this session

### 1. `app/api/subscriptions/downgrade/route.ts`
- Map client validation errors to **400** (including `Trial cannot be selected…`, plan/module mismatch)
- Re-throw client errors from module path instead of silently falling back to legacy

### 2. `components/subscription/SubscriptionChangePlanModal.tsx`
- `credentials: 'include'` on downgrade preview fetch
- Show toast + close confirm step when preview API fails (no false “no data impact”)

---

## E2E command

```bash
$env:PLAYWRIGHT_SKIP_WEBSERVER='1'   # if npm run dev already running
npx playwright test e2e/plan-change-flow.spec.ts e2e/plan-admin-hardening.spec.ts e2e/plan-settings-coverage.spec.ts
```

**Result:** 9 passed, 1 skipped, 1 flaky (invoices GET timeout on first attempt; passed on retry)

---

## Manual spot-checks (optional before deploy)

- [ ] `/settings/subscription` — no false offline banner
- [ ] `/settings/products` — loads (not on staging yet)
- [ ] Change Plan → downgrade to Free → Schedule downgrade completes
- [ ] Feature categories show human labels (Inventory, Tools)

---

## Staging-only (defer until deploy)

- Platform admin login on VPS
- Razorpay paid checkout
- nginx / deploy gap confirmation
