# Payment Provider Readiness Report

**Date:** 2026-06-23  
**Scope:** Pre-Razorpay integration audit — subscription activation, API bypass, provider abstraction, webhook resilience  
**Evidence:** Unit tests (9), E2E API tests (5), code audit

---

## Executive summary

| Area | Status | Notes |
|------|--------|-------|
| Paid plan activation without payment | **Blocked** | Upgrade returns 402/503; checkout creates pending tx only |
| Module activation without payment | **Blocked** | `POST /api/modules` → 403 |
| Direct subscription assignment | **Blocked** | `POST /api/subscriptions/current` → 403 |
| Webhook signature verification | **Implemented** | HMAC SHA-256, timing-safe compare |
| Webhook idempotency | **Implemented** | `platform_billing_webhook_events` unique key |
| Failed payment → no access | **Verified** | Failed webhooks do not call `completeSubscriptionCheckoutPayment` |
| Provider abstraction (platform SaaS) | **Partial** | Tenant UPI payments abstracted; platform billing Razorpay-coupled |
| Production Razorpay go-live | **Pending** | Configure env + staging smoke test |

**Verdict:** Safe to integrate Razorpay for platform billing **after** addressing the medium-priority gaps below (legacy webhook path, platform provider abstraction). Core revenue paths are guarded.

---

## 1. Subscription activation paths

### Allowed (by design)

| Path | Trigger | Verification | Module enabled? |
|------|---------|--------------|-----------------|
| **Signup** | `POST /api/signup` | Product-line trial/free plan seeding | Yes — trial/free only |
| **Free plan upgrade** | `POST /api/subscriptions/upgrade` | `computePlanAmount() === 0` | Yes — after amount check |
| **100% coupon / zero checkout** | `POST /api/subscriptions/checkout` | `resolveCheckoutPricing()` + `validateCoupon()` | Yes — instant via `applyInstantPlanUpgradeWithCoupon` |
| **Paid checkout** | `POST /api/subscriptions/checkout` | Creates **pending** `billing_transactions` + Razorpay link | **No** until webhook |
| **Verified webhook** | `POST /api/webhooks/platform-billing/razorpay` | Signature + idempotency → `completeSubscriptionCheckoutPayment` | Yes |
| **Platform admin** | `PATCH /api/admin/businesses/[id]/subscription` | `requirePlatformRequest` (admin JWT) | Yes — support override |

### Blocked

| Path | Response |
|------|----------|
| `POST /api/modules` | 403 `MODULE_REQUIRES_CHECKOUT` |
| `POST /api/subscriptions/current` | 403 `SUBSCRIPTION_ASSIGNMENT_FORBIDDEN` |
| `POST /api/subscriptions/upgrade` (paid plan) | 402 `REQUIRES_CHECKOUT` or 503 `PAYMENT_NOT_CONFIGURED` |
| `POST /api/subscriptions/checkout` (paid, no Razorpay) | 503 `PAYMENT_NOT_CONFIGURED` |
| Fake webhook (invalid signature) | 401 |

### Flow diagram

```
Paid plan request
  → POST /api/subscriptions/checkout
  → billing_transactions.status = 'pending'
  → Razorpay Payment Link URL returned
  → User pays
  → Razorpay webhook (signed)
  → processPlatformRazorpayWebhook
  → completeSubscriptionCheckoutPayment
  → applyModuleSubscriptionPlanChange + enableBusinessModule

Missing webhook → module stays inactive (pending tx only)
Failed webhook   → tx status 'failed', no applyModule*
Duplicate webhook → idempotency key conflict → skip activation
```

**Key files:** `lib/platform-subscription-checkout.ts`, `lib/platform-billing.ts`, `lib/subscription/apply-module-plan-change.ts`

---

## 2. API bypass audit

| API | Can activate paid plan? | Can activate module? | Can create active subscription? |
|-----|-------------------------|----------------------|----------------------------------|
| `POST /api/modules` | — | **No** (403) | — |
| `POST /api/subscriptions/current` | **No** (403) | — | **No** (403) |
| `POST /api/subscriptions/upgrade` | **No** if amount > 0 | Only ₹0 plans | Via module apply (free only) |
| `POST /api/subscriptions/checkout` | Redirect only until webhook | — | Pending tx only |
| `POST /api/subscriptions/ensure-subscription` | **No** — assigns `free` only if missing | — | Free plan only |
| `PATCH /api/admin/.../subscription` | **Yes** — platform admin only | Partial (legacy row) | Yes — audited admin action |

**E2E evidence:** `e2e/payment-readiness.spec.ts` — 5/5 passed

---

## 3. Payment provider abstraction

### Tenant invoice / order payments (good abstraction)

| Layer | Implementation |
|-------|----------------|
| Interface | `PaymentProvider` in `lib/payments/types.ts` |
| Registry | `lib/payments/registry.ts` — mock, cashfree, razorpay, payu, phonepe, instamojo |
| Factory | `createPaymentProviderForBusiness(businessId, providerId)` |
| Webhook (tenant) | `app/api/payments/webhook/` via provider `verifyWebhook()` |

**Stripe/Cashfree replacement:** Register factory + implement `PaymentProvider`; tenant flows already provider-agnostic.

### Platform SaaS billing (Razorpay-coupled today)

| Component | Coupling |
|-----------|----------|
| `lib/platform-subscription-checkout.ts` | Direct `RazorpayPaymentProvider`, `getPlatformRazorpayProvider()` |
| `lib/platform-billing.ts` | `processPlatformRazorpayWebhook` — Razorpay-specific name |
| `lib/platform-addon-checkout.ts` | Direct Razorpay payment links |
| Webhook route | `/api/webhooks/platform-billing/razorpay` — hardcoded path |

**Recommendation before multi-PSP:** Introduce `PlatformBillingProvider` interface mirroring `PaymentProvider`, route webhooks to `/api/webhooks/platform-billing/[provider]`, delegate to `processPlatformBillingWebhook(providerId, ...)`.

**Business logic separation (good):** `completeSubscriptionCheckoutPayment`, `applyModuleSubscriptionPlanChange`, and coupon redemption are provider-agnostic once webhook is verified.

---

## 4. Webhook simulation results

| Scenario | Expected | Test result |
|----------|----------|-------------|
| **Fake webhook** (bad signature) | Reject, no activation | ✅ Unit + E2E (401/503) |
| **Invalid signature** | `verified: false` | ✅ `tests/lib/razorpay-webhook-verify.test.ts` |
| **Tampered body (replay)** | Signature mismatch | ✅ Unit test |
| **Missing signature header** | Reject | ✅ Unit test |
| **Missing webhook** | Pending tx, no module | ✅ By design (checkout never calls apply*) |
| **Duplicate webhook** | Idempotent skip | ✅ Unit — `{ duplicate: true }`, no second `completeSubscriptionCheckoutPayment` |
| **Failed payment event** | No subscription apply | ✅ Unit — `completeSubscriptionCheckoutPayment` not called |
| **Verified success** | Activate once | ✅ Unit — `completeSubscriptionCheckoutPayment` called |

### Idempotency mechanism

```sql
INSERT INTO platform_billing_webhook_events (provider, idempotency_key, ...)
ON CONFLICT (provider, idempotency_key) DO NOTHING
```

Key = `SHA256(platform|razorpay|eventType|providerPaymentId|status)`

### Signature verification

- Header: `X-Razorpay-Signature`
- Algorithm: HMAC-SHA256(webhook_secret, raw_body)
- Compare: `timingSafeEqual` on hex buffers

---

## 5. Paid modules inactive until verification

| Stage | `business_module_subscriptions` | `business_modules.enabled` |
|-------|--------------------------------|---------------------------|
| Checkout started | Unchanged | Unchanged |
| Payment pending | Unchanged | Unchanged |
| Webhook success | Upsert active plan | `enableBusinessModule()` |
| Webhook failed | Unchanged | Unchanged |
| Duplicate webhook | Idempotent upsert (same state) | No double-enable |

**Duplicate subscriptions:** `business_module_subscriptions` uses `ON CONFLICT (business_id, module_key) DO UPDATE` — no duplicate rows.

**billing_transactions dedup:** `recordBillingTransaction` checks existing `payment_reference` before insert.

---

## 6. Approved free-plan flow

| Check | Implementation |
|-------|----------------|
| Amount validation | `computePlanAmount()` in upgrade route |
| Trial not purchasable | `TRIAL_NOT_SELECTABLE` on upgrade/checkout |
| Free plan routing | Checkout rejects → "Use upgrade endpoint" |
| Coupon validation | Server-side `validateCoupon()` before instant apply |

**E2E:** HR user + `plan_id: free` → upgrade 200 → invoices API 200 ✅

---

## 7. Gaps & recommendations (ranked)

| Severity | Gap | Recommendation |
|----------|-----|----------------|
| **Medium** | Legacy webhook path in `processPlatformRazorpayWebhook` (lines 539–562) can `UPDATE business_subscriptions` without `applyModuleSubscriptionPlanChange` when notes lack `billing_transaction_id` | Remove legacy path or require `billing_transaction_id` + module checkout meta |
| **Medium** | Platform billing not using `PaymentProvider` registry | Add `PlatformBillingProvider` abstraction before Stripe/Cashfree |
| **Medium** | `POST /api/subscriptions/ensure-subscription` lets tenants self-assign **free** plan | Restrict to internal/cron or require admin |
| **Low** | Admin can assign any plan without payment record | Accept for support; optionally require billing tx for paid plans |
| **Low** | `completeSubscriptionCheckoutPayment` doesn't assert tx was `pending` before complete | Add status guard for defense-in-depth |
| **Low** | Return URL success query param is not trusted for activation | Already correct — UI only; activation is webhook-only |

---

## 8. Test commands

```powershell
# Unit — webhook crypto + handler logic
npm test -- tests/lib/razorpay-webhook-verify.test.ts tests/lib/platform-billing-webhook.test.ts

# E2E — API bypass + fake webhook
$env:PLAYWRIGHT_SKIP_WEBSERVER="1"
$env:PLAYWRIGHT_BASE_URL="http://localhost:3101"
$env:E2E_DISABLE_RATE_LIMIT="true"
npx playwright test e2e/payment-readiness.spec.ts
```

---

## 9. Razorpay integration checklist (staging)

1. Set `PLATFORM_RAZORPAY_KEY_ID`, `PLATFORM_RAZORPAY_KEY_SECRET`, `PLATFORM_RAZORPAY_WEBHOOK_SECRET`
2. Register webhook URL: `https://staging.khatario.com/api/webhooks/platform-billing/razorpay`
3. Smoke test: checkout → pay → verify module enabled + `billing_transactions.status = completed`
4. Replay same webhook → confirm duplicate handling
5. Decline payment → confirm module not enabled
6. Attempt `POST /api/subscriptions/upgrade` with paid plan → 402

---

## 10. Production readiness (payment)

| Criterion | Ready? |
|-----------|--------|
| No tenant bypass for paid plans | ✅ |
| Webhook signature required | ✅ |
| Idempotent webhook processing | ✅ |
| Failed payments don't grant access | ✅ |
| Provider abstraction (platform) | ⚠️ Partial — Razorpay OK for v1 |
| Staging end-to-end paid checkout | ⏳ After env config |
| Legacy webhook path removed | ❌ Recommended before go-live |

**Overall:** **Ready for Razorpay staging integration.** Not yet ready to claim multi-PSP portability for platform billing without the abstraction refactor above.
