# Staging QA — Admin plans & user plan switch

**Date:** 2026-06-25  
**Environment:** https://staging.khatario.com  
**Tester:** Automated (browser MCP + API)

---

## Executive summary

| Area | Result |
|------|--------|
| User subscription settings UI | **PASS** (loads, usage, features, modals) |
| Change Plan modal | **PASS** (lists all plans, downgrade confirm UI) |
| Free plan switch (API) | **PASS** (trial → free instant) |
| Paid plan switch (API) | **PASS** (503 `PAYMENT_NOT_CONFIGURED` — expected without Razorpay) |
| Downgrade preview (API) | **FAIL** (HTTP 500) |
| Admin `/admin/plans` changes | **BLOCKED** (no platform admin credentials on staging) |
| `/settings/products` | **FAIL** (404 — not deployed) |
| Recent code fixes (session UX, offline banner, labels) | **NOT on staging** yet |

**Verdict:** User-facing plan switch works for **free** upgrades; paid path correctly blocks without payment. **Deploy latest code** before re-testing fixes. **Provide staging platform admin login** to complete admin matrix QA.

---

## Test accounts

| Account | Phone | Business | Notes |
|---------|-------|----------|-------|
| Fresh QA (API) | `88824195273` | `4a9c14e3-8df0-40c9-bde2-d58c396b0aae` | Created this run; upgraded trial→free via API |
| Browser session | `88823845259` | E2E QA Sub 82384525 | Prior QA account; trial plan UI tests |

Password (both): `E2E_Sub_audit!2026`

---

## 1. Admin plans QA

### Attempted
- `POST /api/admin/auth/login` with `admin@khatario.com` / `admin123` → **401 Unauthorized**
- Browser: `/admin/login` reachable; could not proceed without valid credentials

### Not tested (blocked)
- Open **Limits** matrix for `trial` / `free` and change `max_customers`
- Open **Features** matrix and toggle a feature (e.g. `dead_stock_widget`)
- Verify tenant `check-limit` and API 403 reflect admin change within 60s

### Required to finish
- Staging platform admin email + password (or one-time token), **or**
- SSH to VPS + run admin password reset script

---

## 2. User plan switch — API

### Signup + login
- `POST /api/signup` → **200**, plan `trial`

### Upgrade trial → free (₹0)
```
POST /api/subscriptions/upgrade
{ plan_id: "free", module_key: "billing", billing_cycle: "monthly" }
→ 200 success
GET /api/subscriptions/current → plan_id: free, display: "Free / Starter"
```

### Limits after free plan (enforcement spot-check)
| limit_type | limit | current | allowed |
|------------|-------|---------|---------|
| invoices | 20 | 0 | true |
| customers | 10 | 0 | true |
| items | 10 | 0 | true |
| users | 1 | 1 | **false** (at cap — correct) |

`enabled_features` count: **24** (registry-backed list present)

### Upgrade to paid (professional)
```
POST /api/subscriptions/upgrade { plan_id: "professional", ... }
→ 503 PAYMENT_NOT_CONFIGURED
```
**Expected** on staging until Razorpay env is configured.

### Downgrade preview
```
POST /api/subscriptions/downgrade
{ target_plan_id: "trial", module_key: "billing", confirmed: false }
→ 500 Internal Server Error
```
**Bug** — should return 200 with `warnings` array (or 400 with clear message).

### Module subscriptions API
```
GET /api/subscriptions/modules/current → 404
```
Route exists in repo; **staging build behind** local `main`.

---

## 3. User plan switch — UI (browser)

**URL:** `/settings/subscription`  
**Account:** E2E QA Sub 82384525 (trial)

### PASS
- Page title **Subscription & Billing**
- Trial card: limits (50 invoices, 10 customers, 5 users, 500 WhatsApp/day)
- **Current Usage** bars (invoices, customers, items, users)
- **Features Included** grouped list (sales, purchases, HR, …)
- **Change Plan** opens modal with Free, Professional, Business, Enterprise, Trial
- **Downgrade** to Free opens **Confirm Downgrade** step (“You're downgrading to Free / Starter”)
- **Explore Add-ons**, coupon field, cancel section present

### FAIL / known (pre-deploy)
- **False offline banner:** “No Internet Connection Found” while online
- **Raw category labels:** `inventory`, `tools` (lowercase) under Features Included
- **`/settings/products`:** 404

### Not completed in UI
- **Schedule Downgrade** button stayed disabled (preview API 500 may block warnings)
- **Upgrade to Professional** checkout redirect (not clicked through; API already shows 503)

---

## 4. Deploy gap checklist

Staging is missing recent local changes. After `bash scripts/deploy-vps.sh`:

- [ ] `/settings/products` loads
- [ ] `GET /api/subscriptions/modules/current` returns 200
- [ ] Offline banner hidden when online
- [ ] Feature categories show “Inventory” / “Tools”
- [ ] Session-expired message instead of generic error on 401

---

## 5. Recommended next steps

1. **Deploy** current branch to staging (`scripts/deploy-vps.sh`).
2. Share **platform admin credentials** (or reset on VPS) → re-run admin Limits/Features matrix + enforcement loop.
3. **Fix** `POST /api/subscriptions/downgrade` 500 when `confirmed: false`.
4. Configure **Razorpay staging** → re-test paid upgrade UI end-to-end.
5. Re-run: `PLAYWRIGHT_BASE_URL=https://staging.khatario.com npx playwright test e2e/plan-change-flow.spec.ts` (after deploy).

---

## Health score (user plan flow only)

| Dimension | Score | Notes |
|-----------|-------|-------|
| Subscription page load | 9/10 | Rich content; minor banner noise |
| Plan change UX | 7/10 | Modal good; downgrade schedule blocked by API 500 |
| Enforcement visibility | 8/10 | Usage + limits match free plan |
| Deploy completeness | 5/10 | products route + modules API missing |
| Admin ↔ tenant loop | 0/10 | Not tested (auth blocked) |

**Overall staging readiness for plan switching:** **6.5/10** — free path OK; deploy + admin creds + downgrade fix needed for full sign-off.
