# Trial Downgrade Verification Report

**Date:** 2026-06-06  
**Scope:** Source-code verification only (no runtime tests, no code changes)  
**Business rule under test:** New signup → 30-day trial with full access → trial expires → automatic move to Free/Starter → historical data visible → future usage constrained by Free limits.

---

## Executive Summary

| Question | Answer |
|----------|--------|
| Is downgrade implemented? | **Partially** — yes for DB reassignment, but not automatically on first calendar expiry |
| Is plan reassignment implemented? | **YES** — reassignment target is always plan id `free` (display name “Free / Starter”) |
| Are historical records preserved? | **YES** — no deletion/hiding/locking of existing rows on downgrade |
| Are Free/Starter limits applied after downgrade? | **Partially** — limits apply via `getEntitlementPlanId` + `checkLimit`, but enforcement is inconsistent while DB still shows `plan_id = trial` |
| **Final verdict** | **FAIL** |

---

## Phase 1 — Trial Expiry Flow

### Trial creation

| Step | Location | Behavior |
|------|----------|----------|
| Signup assigns trial | `app/api/signup/route.ts` (lines ~234–300) | If active `subscription_plans` row with `id = 'trial'` exists: `plan_id = 'trial'`, `status = 'trial'`, `trial_end_date = CURRENT_DATE + 30 days`. Otherwise falls back to `free` + `active` with a console warning. |
| Trial plan definition | `database/migrations/154_add_trial_subscription_plan.sql`, `database/seed_subscriptions.sql` | Trial plan clones entitlements from `enterprise` (or `business`) — effectively unrestricted/high-tier limits during trial. |
| Trial constants | `lib/subscription/lifecycle.ts` (`TRIAL_DAYS = 30`), `lib/subscription/trial-plan.ts` (`TRIAL_PLAN_ID = 'trial'`) | 30-day signup window; trial is signup-only, not a billing picker target. |

### What happens when trial expires?

There are **three parallel mechanisms**, not one unified path:

1. **Logical entitlement downgrade (no DB write)**  
   - `lib/subscription/effective-plan.ts` — `getEntitlementPlanId()` returns `'free'` when `plan_id === 'trial'` and calendar `trial_end_date` is in the past (`isTrialEntitlementActive()` false).  
   - Used by `checkLimit()` / `checkLimitInTransaction()` in `lib/subscription.ts` (lines ~304–306, ~423–429).

2. **Hard block on expired trial status (before free-tier feature matrix)**  
   - `lib/subscription/feature-access.ts` — `assertFeatureAccess()` (lines ~286–294): if `status === 'trial'` and `checkTrialExpiry()` reports expired, throws `SUBSCRIPTION_EXPIRED`.  
   - `lib/security/require-operational-subscription.ts` (lines ~73–81): same check → `TRIAL_EXPIRED` for premium/operational wrappers.  
   - `lib/subscription/lifecycle.ts` — `checkTrialExpiry()`: `isInGracePeriod` is **always `false`** (automatic post-expiry grace removed; comment references Option A extension flow).

3. **DB downgrade to Free (`plan_id = 'free'`, `status = 'active'`)**  
   - `lib/subscription/lifecycle.ts` — `moveSubscriptionToFree()` / `downgradeToFree()` (lines ~439–474): sets `plan_id = 'free'`, clears trial fields, logs event.  
   - Triggered only by:
     - **User action:** `declineSelfServeTrialExtension()` in `lib/subscription/trial-extension.ts` (lines ~104–119) via `POST /api/subscriptions/trial-extension` with `action: 'decline'`.  
     - **Cron (narrow case):** `processExpiredSubscriptions()` in `lib/subscription/lifecycle.ts` (lines ~498–515) — only rows where `plan_id = 'trial'` **and** `trial_extension_granted = true` **and** `trial_end_date < CURRENT_DATE`.  
     - **Login sync:** `GET /api/subscriptions/current` in `app/api/subscriptions/current/route.ts` (lines ~90–95) calls `moveSubscriptionToFree()` when `shouldDowngradeStaleTrial()` is true (same condition as cron: extension used + expired).

### Answers (Phase 1)

| # | Question | Answer |
|---|----------|--------|
| 1 | What happens when trial expires? | Calendar expiry stops trial entitlements logically (`getEntitlementPlanId` → `free`). User sees extend-or-free modal (`TrialExtensionModal`, `shouldOfferTrialExtension`). Most mutating APIs that call `assertFeatureAccess` return subscription expired while DB may still show `plan_id = trial`. DB row stays on trial until user declines extension, extension expires (cron/sync), or signup had no trial plan. |
| 2 | Is there automatic downgrade? | **Not on first expiry.** No cron job moves a first-time expired trial to Free without `trial_extension_granted = true`. Automatic DB downgrade exists only after the one-time 7-day extension also expires, or when user clicks “Continue on Free plan”. |
| 3 | Is there automatic plan reassignment? | **Conditional.** Reassignment is automatic only via cron/sync **after extended trial**, or immediate on user decline. Otherwise reassignment is **logical only** via `getEntitlementPlanId`. |
| 4 | Which plan is assigned? | Always **`free`** (`moveSubscriptionToFree` hard-codes `'free'`). There is no separate `starter` plan id; seed data labels it **“Free / Starter”** (`database/seed_subscriptions.sql` line ~69). |
| 5 | Which code performs the downgrade? | DB: `moveSubscriptionToFree()` in `lib/subscription/lifecycle.ts`. Cron: `processExpiredSubscriptions()` → `app/api/cron/check-subscriptions/route.ts`. User: `declineSelfServeTrialExtension()` in `lib/subscription/trial-extension.ts`. Logical: `getEntitlementPlanId()` in `lib/subscription/effective-plan.ts`. |

### Scheduled jobs

| Job | File | Trial-related work |
|-----|------|-------------------|
| Daily subscription cron | `app/api/cron/check-subscriptions/route.ts` | Calls `processExpiredSubscriptions()` — trial batch limited to post-extension expiry (see above). Also usage snapshots (counts all invoices/customers/items in DB, not plan-filtered). |

---

## Phase 2 — Entitlement Resolution

### Plan / feature / limit sources

| Layer | Files | Role |
|-------|-------|------|
| Plan matrix (features) | `subscription_plan_features` + `platform_features`; read in `lib/subscription/feature-access.ts` (`getEnabledFeaturesFromRegistry`, `assertFeatureAccess`) | Authoritative for premium modules (GST ledger routes, purchases, WhatsApp, etc.) |
| Limit matrix | `subscription_plan_limits` + `platform_limits`; resolved by `resolvePlanLimitValue()` in `lib/subscription.ts` | Numeric caps per plan |
| Legacy JSONB | `subscription_plans.features` | Fallback when registry row missing; merged in `getBusinessSubscription()` |
| Effective plan | `lib/subscription/effective-plan.ts` | Maps calendar-expired trial → `'free'` for **limits and UI display** |

### Free plan limits (seed defaults)

From `database/seed_subscriptions.sql` (`id = 'free'`):

- `max_invoices_per_month`: 20  
- `max_customers`: 10  
- `max_items`: 10  
- `max_users`: 1  
- `max_whatsapp_per_day`: 0  
- Premium flags in JSONB largely `false` (e.g. `reports_gst`, `purchase_management`, `supplier_management`)

Registry rows in DB may override seed JSONB at runtime.

### When a business is downgraded, checks use:

| Check type | Resolution | Evidence |
|------------|------------|----------|
| **Usage limits** | **B — Assigned plan limits via `getEntitlementPlanId()`** | `checkLimit()` / `checkLimitInTransaction()` use `entitlementPlanId`, not raw `subscription.plan_id` (`lib/subscription.ts` ~304–306, ~423–442). Expired trial → Free limits even if DB still says `trial`. |
| **Feature access (most routes)** | **A + B, but expired trial blocks first** | `assertFeatureAccess()` checks operational status and **rejects calendar-expired trial before** `getEntitlementPlanId()` registry lookup (`feature-access.ts` ~286–313). |
| **Operational premium APIs** | **A — Subscription status + trial expiry** | `requireOperationalSubscription()` (`lib/security/require-operational-subscription.ts`) denies expired trial with `TRIAL_EXPIRED` regardless of logical free entitlements. |
| **UI subscription payload** | **B (display) + mixed operational flag** | `GET /api/subscriptions/current` uses `getDisplayPlanId` / `getEntitlementPlanId` and loads limits/features for `limitsPlanId` (often `free` when trial calendar expired). `is_operational` remains true while `status === 'trial'` even after calendar expiry (`current/route.ts` ~154–157). |

**Code path summary:** Limits follow **entitlement plan** (C = status + derived plan). Feature gates on mutation paths follow **status-first expiry gate**, then **plan matrix** — so expired-trial rows do not behave like Free for `assertFeatureAccess` even though limits already do.

---

## Phase 3 — Historical Data Access

Inspection of list/detail handlers shows **no plan-based filtering** on reads.

| Entity | List/detail routes | Enforcement on GET | Verdict |
|--------|-------------------|--------------------|---------|
| Invoices | `app/api/invoices/route.ts` GET | RBAC (`authorize`) only; no subscription filter | **D — Accessible** |
| Customers | `app/api/customers/route.ts` GET | RBAC only | **D — Accessible** |
| Items | `app/api/items/route.ts` GET, `app/api/items/[id]/route.ts` GET | RBAC only | **D — Accessible** |
| Suppliers | `app/api/suppliers/route.ts` GET (pattern matches customers) | RBAC / tenant | **D — Accessible** |
| Purchases | `app/api/purchases/route.ts` GET | No `enforceAccess` on read path (write uses feature gate) | **D — Accessible** |

Downgrade helpers explicitly **warn** about over-limit usage but do not delete data:

- `getDataImpactWarnings()` in `lib/subscription/lifecycle.ts` (lines ~171–261) compares counts vs target plan; no DELETE/UPDATE on entity tables.

**No evidence** of hiding (A), deleting (B), or locking (C) historical records on trial expiry or move to Free.

---

## Phase 4 — Limit Enforcement

Count logic: `lib/subscription/limit-registry.ts` → `buildLimitCountQuery()`.

| Limit type | Count basis | SQL evidence |
|------------|-------------|--------------|
| Invoices | **Monthly** | `created_at >= DATE_TRUNC('month', CURRENT_DATE)` |
| Customers | **Total historical** | `COUNT(*) FROM customers WHERE business_id = $1` |
| Items | **Total historical** | `COUNT(*) FROM items WHERE business_id = $1` |
| Suppliers | **Total historical** | `COUNT(*) FROM suppliers WHERE business_id = $1` |
| Purchases | **Monthly** | `bill_date >= month start`, `deleted_at IS NULL` |
| Users | **Total historical** | `COUNT(*) FROM users WHERE business_id = $1` |
| WhatsApp | **Daily** | `whatsapp_messages.sent_at >= CURRENT_DATE` |

Allow rule: `allowed = currentCount < maxLimit` (`lib/subscription.ts` ~338).

### Scenario: 100 trial-created items, Free limit 10

| Action | Route / mechanism | Actual behavior (source) |
|--------|-------------------|--------------------------|
| View item #57 | `GET /api/items/[id]` | Allowed — no subscription check |
| Edit item #57 | `PATCH /api/items/[id]` | Allowed — no `enforceAccess` / `checkLimit` on grep |
| Delete item #57 | DELETE handler on same file | Allowed — no limit check |
| Create item #101 | `POST /api/items` → `checkLimitInTransaction(..., 'items')` | **Blocked** — `current=100`, `limit=10`, `allowed=false` (403 `SUBSCRIPTION_LIMIT_EXCEEDED`) |

Same pattern for customers (total count) and invoices (monthly count in current month).

### Premium features after Free entitlement

- GST API routes use `enforceAccess` with `FeatureKeys.LEDGER_ACCOUNTING` (e.g. `app/api/gst/payment/route.ts`).  
- Free plan registry/seed disables advanced modules (`purchase_management`, `supplier_management`, `reports_gst`, etc.).  
- After DB is on `free` + `active`, `assertFeatureAccess` uses `entitlementPlanId = 'free'` and denies non-enabled registry features.

---

## Phase 5 — Simulated Downgrade (source-only)

**Setup:** Trial business with 100 invoices (same month), 100 customers, 100 items. Trial calendar expires. User lands on Free entitlements (either logical only or after “Continue on Free”).

### State A — Expired trial, user has **not** clicked “Continue on Free”

| Capability | Result | Why |
|------------|--------|-----|
| View lists/detail | **Works** | GET routes lack subscription expiry checks |
| Create invoice | **Fails** | `enforceAccess` → `assertFeatureAccess` → `SUBSCRIPTION_EXPIRED` |
| Create customer | **Fails** | Same (even though `customer_management` is a “core” key, trial expiry check runs first) |
| Create item | **Fails on limit** | `checkLimitInTransaction` only — uses Free limit (100 ≥ 10), not trial expiry |
| GST / ledger / premium GET | **Fails on wrapped routes** | `withPremiumSubscriptionApi` → `requireOperationalSubscription` → `TRIAL_EXPIRED` |
| DB `plan_id` | Still **`trial`** | No automatic `moveSubscriptionToFree` on first expiry |

### State B — User chose **“Continue on Free”** (`declineSelfServeTrialExtension`)

| Capability | Result | Why |
|------------|--------|-----|
| DB row | **`plan_id = free`, `status = active`** | `moveSubscriptionToFree()` |
| View all 100 records | **Works** | Unchanged data; GET unchanged |
| Create invoice #101 (same month) | **Fails** | Monthly count 100 vs limit 20 |
| Create customer #11 | **Fails** | Total count 100 vs limit 10 |
| Create item #11 | **Fails** | Total count 100 vs limit 10 |
| Edit/delete existing | **Works** | No limit on update/delete paths inspected |
| GST reports / purchases / suppliers create | **Fails** | Free plan feature matrix + `enforceAccess` |
| Core invoicing for **new** docs under cap | **Would work if under limits** | `enforceAccess` passes when under monthly invoice cap and feature enabled on Free |

### State C — User took **7-day extension**, then extension expires

| Capability | Result | Why |
|------------|--------|-----|
| DB downgrade | **Automatic** (cron or `/api/subscriptions/current` sync) | `processExpiredSubscriptions` / `shouldDowngradeStaleTrial` |
| Behavior after | Same as State B | `plan_id = free` |

---

## Mismatch vs Intended Business Rule

| Expected | Actual in source |
|----------|------------------|
| Trial expires → **automatic** move to Free/Starter | First expiry does **not** update DB; user must decline extension or complete extension-then-expire path |
| Separate “Starter” plan option | Only **`free`** plan id; “Starter” is display text only |
| After downgrade, **future** usage follows Free limits while history visible | **History visible — YES.** **Future limits — YES** once enforcement paths agree; **during expired-trial limbo**, mutations are blocked by `SUBSCRIPTION_EXPIRED` rather than Free-tier feature/limit rules (except item create which hits limit only) |
| User can continue normal business on Free within limits | **After explicit DB downgrade to free**, yes within caps; **during expired-trial without decline**, core creates are largely blocked |
| Unrestricted access during trial | **YES** — trial plan clones enterprise/business matrix (`154_add_trial_subscription_plan.sql`) |

---

## Final Checklist

| # | Item | Result |
|---|------|--------|
| 1 | Is downgrade implemented? | **YES** (DB + logical), but **not** fully automatic on first trial expiry |
| 2 | Is plan reassignment implemented? | **YES** → always **`free`** |
| 3 | Are historical records preserved? | **YES** |
| 4 | Are Free/Starter limits applied after downgrade? | **YES** for limit counters via `getEntitlementPlanId`; **NO** consistent application while expired trial row persists and `assertFeatureAccess` rejects all non-synced paths |
| 5 | Mismatch with business rule? | **YES** — see table above |

## Final Verdict: **FAIL**

The implementation does **not** match the stated business rule exactly. Historical data preservation and post-downgrade numeric limits are largely correct, but **automatic downgrade on first trial expiry is not implemented**, and the **expired-trial intermediate state** blocks operations differently than a Free-plan user (subscription expired vs plan limits).

---

*Verification performed by static analysis of application source. No code was modified.*
