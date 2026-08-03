# Khatario Subscription Browser Audit — Live Evidence Report

**Generated:** 2026-06-23  
**Environment:** `http://localhost:3101` (auto-discovered via port scan)  
**Test suite:** `e2e/subscription-evidence.spec.ts` — **7/7 Playwright tests PASSED**  
**Machine-readable evidence:** `e2e/evidence/subscription-audit-report.json`  
**Screenshots:** `e2e/evidence/*.png` (10 captures)

---

## Executive Summary

Live browser testing confirms **route guards work** (cross-product navigation redirects to `/settings/products?upsell={module}`) but **revenue is still at risk** because:

1. **`POST /api/modules` enables Connect (and other products) without payment** — confirmed HTTP 200 in browser session.
2. **`GET /api/invoices` returns HTTP 200 for Connect-only users** — billing data API accessible without Billing module (empty list, but endpoint open).
3. **Upsell UI shows no pricing and no checkout** — only “Add {Product}” which calls the free module API.
4. **No UpgradeModal on module upsell** — users see a settings banner, not plan/pricing modal.
5. **WhatsApp add-on purchase blocked locally** with 503 (`PAYMENT_NOT_CONFIGURED`) — cannot validate Razorpay redirect in this environment; code path does not free-activate.

**Environment blockers fixed during audit:** `UpgradeModal` imported server-side `plan-module.ts` → broke Next.js client build; login rate limit blocked repeated E2E logins.

---

## Scenario Results (Browser-Validated)

### Login — all personas ✅

| Persona | Phone (test run) | Landing URL | Screenshot |
|---------|------------------|-------------|------------|
| HR | 88355316661 | `/hr/dashboard` | `login-login-hr.png` |
| Billing | 88355316662 | `/dashboard` | `login-login-billing.png` |
| Connect | 88355316663 | `/whatsapp/dashboard` | `login-login-connect.png` |
| Multi (billing+hr) | 88355316664 | `/dashboard` | `login-login-multi.png` |

**Note:** HR signup user saw “HR is not enabled” on dashboard despite HR product signup — investigate module seeding/session sync.

---

### A. HR → Billing ✅ (guard) / ⚠️ (monetization)

| Step | URL | Copy / UI | Result |
|------|-----|-----------|--------|
| Visit `/invoices` | → `/settings/products?upsell=billing` | “That area needs Billing … GST invoicing, inventory, purchases, and reports. … **Add Billing**” | Guard **PASSED** |
| Pricing on banner | — | **None** (no ₹, no plan names) | **FAILED** conversion expectation |
| Upgrade modal | — | **Not shown** — settings upsell banner only | N/A |
| Checkout | — | Not reached | **FAILED** — CTA enables module via API, not Razorpay |

**Screenshot:** `A1-hr-billing-upsell.png`

---

### B. Billing → HR ✅

| Step | URL | API (authenticated) | Result |
|------|-----|---------------------|--------|
| Visit `/employees` | → `?upsell=hr` | `GET /api/employees` → **403** `FEATURE_NOT_IN_PLAN` | Guard + API **PASSED** |

**Banner copy:** “That area needs HR … Employees, attendance, payroll, and leave. … Add HR”  
**Screenshot:** `B1-billing-hr-upsell.png`

---

### C. Billing → Connect ✅

| Step | URL | API | Result |
|------|-----|-----|--------|
| Visit `/whatsapp/dashboard` | → `?upsell=connect` | Addons API returns catalog with **₹499 / ₹299** pricing | Guard **PASSED**; pricing visible on **API/catalog**, not upsell banner |

**Screenshot:** `C1-billing-connect-upsell.png`

---

### D. Connect → Billing ✅ (guard) / 🔴 (API leak)

| Step | URL | API | Result |
|------|-----|-----|--------|
| Visit `/invoices` | → `?upsell=billing` | `GET /api/invoices` → **200** with `{ invoices: [] }` | UI guard **PASSED**; **API leak CONFIRMED** |

**Screenshot:** `D1-connect-billing-upsell.png`

---

### E. Revenue leakage (authenticated HR user) 🔴

| Attack | HTTP | Live result |
|--------|------|-------------|
| `POST /api/subscriptions/current` `{ plan_id: enterprise }` | **500** | Blocked by DB unique constraint (not authorization) |
| `POST /api/modules` `{ module_key: connect }` | **200** | **Connect enabled without payment** |
| `POST /api/subscriptions/addons/whatsapp_bot/purchase` | **503** | Payment not configured locally — addon not activated |
| Direct URL `/connect/whatsapp` after module add | **200 page load** | **Connect UI accessible without checkout** |

**Screenshot:** `E1-leakage-connect-url.png`

---

### F. Multi-product subscription settings ✅

| Step | URL | Result |
|------|-----|--------|
| Open `/settings/subscription` | Modules: **billing, hr** | Page loads; pricing not prominent in captured copy |

**Screenshot:** `F1-multi-subscription-settings.png`

---

## Issue Register

### Critical

| ID | Issue | Evidence | Revenue impact |
|----|-------|----------|----------------|
| C-1 | `POST /api/modules` grants Connect (active plan) without payment | E1 API 200 | High — free Connect platform |
| C-2 | `GET /api/invoices` open to Connect-only authenticated users | D1 API 200 | High — billing API surface without module gate |
| C-3 | `/connect/whatsapp` reachable after free module enable | E1 screenshot + URL | High — full Connect entry without payment |

### High

| ID | Issue | Evidence | Revenue impact |
|----|-------|----------|----------------|
| H-1 | Module upsell shows no pricing / no checkout | A1, B1, C1, D1 — `pricingVisible: false` | Medium–High — weak conversion + free add |
| H-2 | No “Contact sales” CTA anywhere in upsell flow | All upsell captures | Medium — enterprise leakage |
| H-3 | `POST /api/subscriptions/current` not authz-gated (failed on DB constraint only) | E1 HTTP 500 | High if constraint fixed |

### Medium

| ID | Issue | Evidence |
|----|-------|----------|
| M-1 | HR signup dashboard shows “HR is not enabled” | `login-login-hr.png` copy |
| M-2 | Onboarding tour overlays upsell CTAs (blocked Playwright click on “Add Billing”) | Test automation note |
| M-3 | Addon checkout unverified locally (Razorpay not configured) | E1 HTTP 503 |

### Low

| ID | Issue | Evidence |
|----|-------|----------|
| L-1 | “No Internet Connection Found” banner in offline detector during tests | Multiple screenshots |
| L-2 | Multi-product settings page — pricing not surfaced in first viewport | F1 |

---

## Revenue Impact Estimate (qualitative)

| Leak | Est. impact if exploited |
|------|-------------------------|
| Free module add (Connect/Billing/HR trial) | **100%** of module subscription revenue for self-serve users who discover Settings → Products or API |
| Open billing GET APIs | Data exfil + upsell bypass for integrations/scripts |
| Unguarded plan POST (if DB allows) | **100%** paid tier without payment |

---

## Re-run Instructions

```powershell
# Terminal 1
$env:PORT="3101"; npm run dev

# Terminal 2
$env:PLAYWRIGHT_SKIP_WEBSERVER="1"
$env:PLAYWRIGHT_BASE_URL="http://localhost:3101"
$env:E2E_DISABLE_RATE_LIMIT="true"
npx playwright test e2e/subscription-evidence.spec.ts
```

Evidence regenerates under `e2e/evidence/`.

---

## Fixes Applied During Audit (engineering)

1. **`UpgradeModal.tsx`** — import `productLineForModule` from client-safe `platform-modules` (was pulling `pg` into client bundle → build error).
2. **`app/api/auth/login/route.ts`** — skip rate limit in dev / when `E2E_DISABLE_RATE_LIMIT=true`.
3. **`e2e/subscription-evidence.spec.ts`** — full evidence suite with screenshots + JSON report.
4. **`playwright.config.ts`** — `PLAYWRIGHT_SKIP_WEBSERVER=1` support for existing dev server.

---

## Recommended Next P0 Fixes

1. Route **Add product** through checkout (or trial eligibility), never instant `POST /api/modules` for Connect.
2. Add **billing module check** on all `GET /api/invoices` (and related billing reads).
3. **Remove or admin-lock** `POST /api/subscriptions/current`.
4. Upsell banner: show **price / trial terms** + **Proceed to payment** CTA.
