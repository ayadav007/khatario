# Billing Money Path Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the defects that let a business get a paid plan without paying, or pay without getting a plan: audit findings SUB-01, 02, 03, 04, 05, 16, 26, 27, 28 and 31.

**Architecture:** Plan changes that cost nothing go through one decision function instead of "any ₹0 plan". Tier order is an explicit rank (free-tier plans at the bottom, then `sort_order`), never price, so a plan priced at ₹1 for testing behaves like its real tier. Payment completion becomes one database transaction with the payment row locked, and the webhook event is marked processed only after it. The nightly job never starts a paid period without a payment, expires add-ons and stale checkouts, and reports payments that were recorded but not applied.

**Tech Stack:** Next.js route handlers (TypeScript), PostgreSQL through `lib/db.ts` (`getPool`, `query`, `queryOne`, `queryRows`), Jest with real-database suites on `kh_phase2_test`.

**Spec:** `docs/qa/subscription-billing-audit-2026-11-26.md` (section D, the finding ids named in each task).

**Not in this plan** (each gets its own plan):
- Refunds, GST and tax invoice, renewal and proration (SUB-06, 07, 11, 13). Blocked on owner decisions.
- Server enforcement gaps (SUB-08, 09, 12, 18 to 25).
- Payment-record constraints and migration chain (SUB-14, 15, 36).
- Customer-facing screens and text (SUB-10, 29, 30, 32 to 34).

## Global Constraints

- Tests and migrations run only on the local disposable database `kh_phase2_test`. Never apply a migration to staging or production; migration files are written, not applied there.
- Database suites follow the header of `tests/db/module-subscription-sole-source.db.test.ts:1-40`: opt-in through `PHASE2_TEST_DATABASE_URL` or `SUBSCRIPTION_DB_TEST=1`, `describe.skip` otherwise, businesses created with `randomUUID()` and deleted in `afterAll`.
- Run database suites with `PHASE2_TEST_DATABASE_URL=postgresql://postgres:<local password>@127.0.0.1:5433/kh_phase2_test DB_SSL=false npx jest <file> --runInBand --forceExit`.
- No real gateway call in any test. Stub `global.fetch`; sign Razorpay bodies with `createHmac('sha256', secret)` and set `PLATFORM_RAZORPAY_KEY_ID=rzp_test_plan`, `PLATFORM_RAZORPAY_KEY_SECRET=k`, `PLATFORM_RAZORPAY_WEBHOOK_SECRET=whsec_plan` in the suite.
- Never trust a client-sent `business_id`, `user_id` or amount. The business comes from `requireTenantBusinessId`.
- Stage files by name. Commit only if the owner asked for commits for this run; otherwise skip each "Commit" step and list the files in the hand-back.
- Error responses keep the existing shape `{ error: string, code: string }`.
- Plan ids used below exist in the seeded catalogue: `free`, `trial`, `billing_starter` (₹299), `billing_growth` (₹499), `billing_business` (₹799), `hr_free`, `hr_trial`, `hr_staff_lite`, `hr_starter` (₹199), `hr_pro` (₹499), `connect` (₹1,499), `connect_free`.
- Any plan price of ₹1 or more must work end to end (owner requirement for live testing): no rule may read price to decide tier, and "paid" means price > 0.
- Trial length is `SIGNUP_TRIAL_DAYS` (30) from `lib/product-lines.ts`; grace is 7 days.
- Append an entry to `docs/project.log.md` when the run ends.

## Review Focus

1. **A business already holding a free plan with an end date** (created by the old `/upgrade`): it must not be locked out or sent grace emails after this change. Pinned in Task 3 (migration and test).
2. **A success webhook arriving after the checkout was expired by the nightly job**: the customer paid, so the plan must activate. Pinned in Task 4.
3. **Two deliveries for one payment at the same instant** (`payment.captured` and `payment_link.paid`): one activation, one coupon redemption, both HTTP 200. Pinned in Task 5.
4. **A business that already used its HR trial asking for it again**: refused, not restarted. Pinned in Task 1.
5. **An AI add-on bought before this change, with no end date**: it must not run forever, and must not vanish without notice. Pinned in Task 7.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/subscription/zero-price-change.ts` (new) | Decide what a no-payment plan request may do |
| `lib/subscription/plan-tier.ts` (new) | Compare two plans of one product by price |
| `app/api/subscriptions/upgrade/route.ts` | Apply the zero-price decision |
| `lib/subscription/module-plan-lifecycle.ts` | Downgrade rule; free plan has no end date |
| `lib/subscription/lifecycle.ts` | Nightly job: guarded updates, no unpaid paid period, add-on and checkout expiry |
| `lib/platform-billing-transaction-state.ts` | Allowed payment-row transitions |
| `lib/platform-billing.ts` | Webhook processing, event state, failed attempts |
| `lib/platform-subscription-checkout.ts` | Transactional completion, free-month coupons, link expiry |
| `lib/subscription/apply-module-plan-change.ts` | Accept a transaction client |
| `lib/platform-addon-checkout.ts` | Add-on period |
| `lib/subscription/reconcile-payments.ts` (new) | Report payments recorded but not applied |
| `database/migrations/477_free_plan_no_end_date_addon_period.sql` (new) | Data repair for existing rows |
| `tests/db/billing-money-path.db.test.ts` (new) | Real-database tests for every task |
| `tests/lib/subscription/zero-price-change.test.ts`, `plan-tier.test.ts` (new) | Pure rule tests |

---

### Task 1: No-payment plan requests go through one rule (SUB-01 part 1, SUB-31)

**Files:**
- Create: `lib/subscription/zero-price-change.ts`
- Modify: `app/api/subscriptions/upgrade/route.ts:44-120`
- Test: `tests/lib/subscription/zero-price-change.test.ts`, `tests/db/billing-money-path.db.test.ts`

**Interfaces:**
- Consumes: `getFreePlanIdForModule` (`lib/subscription/module-operational-check.ts`), `MODULE_ADD_CONFIG` (`lib/subscription/module-entitlements.ts`), `moveModuleSubscriptionToFree`, `upsertModuleSubscription`, `enableBusinessModule`.
- Produces:

```ts
export type ZeroPriceDecision =
  | { action: 'apply_free' }
  | { action: 'start_trial'; trialDays: number }
  | { action: 'reject'; code: 'PLAN_NOT_SELECTABLE' | 'USE_DOWNGRADE' | 'TRIAL_ALREADY_USED'; message: string };

export function decideZeroPriceChange(input: {
  moduleKey: PlatformModule;
  targetPlanId: string;
  current: { plan_id: string; status: string; trial_end_date: string | null } | null;
  currentPlanIsPaid: boolean; // current plan has any cycle price > 0
}): ZeroPriceDecision;
```

Rules, in order:
1. Target is the module's free plan: `USE_DOWNGRADE` when `currentPlanIsPaid`, otherwise `apply_free`.
2. Target is `MODULE_ADD_CONFIG[moduleKey].trialPlanId`, the config is not `paidOnly`, and `current` is null: `start_trial` with that config's `trialDays`.
3. Same target with a `current` row: `TRIAL_ALREADY_USED`.
4. Anything else (`hr_staff_lite`, `connect_free` when a row exists, any other ₹0 plan): `PLAN_NOT_SELECTABLE`.

`connect_free` is the Connect free plan, so rule 1 covers it; it creates a row with no end date.

- [ ] **Step 1: Write the failing rule tests**

```ts
const paidRow = { plan_id: 'billing_business', status: 'active', trial_end_date: null };
it('free plan from a paid plan must go through downgrade', () =>
  expect(decideZeroPriceChange({ moduleKey: 'billing', targetPlanId: 'free', current: paidRow, currentPlanIsPaid: true }))
    .toMatchObject({ action: 'reject', code: 'USE_DOWNGRADE' }));
it('free plan from a trial applies at once', () =>
  expect(decideZeroPriceChange({ moduleKey: 'billing', targetPlanId: 'free', current: { plan_id: 'trial', status: 'trial', trial_end_date: '2026-01-01' }, currentPlanIsPaid: false }))
    .toEqual({ action: 'apply_free' }));
it('first HR add starts a 30-day trial', () =>
  expect(decideZeroPriceChange({ moduleKey: 'hr', targetPlanId: 'hr_trial', current: null, currentPlanIsPaid: false }))
    .toEqual({ action: 'start_trial', trialDays: 30 }));
it('HR trial cannot be taken twice', () =>
  expect(decideZeroPriceChange({ moduleKey: 'hr', targetPlanId: 'hr_trial', current: { plan_id: 'hr_free', status: 'active', trial_end_date: null }, currentPlanIsPaid: false }))
    .toMatchObject({ action: 'reject', code: 'TRIAL_ALREADY_USED' }));
it.each(['hr_staff_lite', 'hr_trial'])('billing module rejects %s', (p) =>
  expect(decideZeroPriceChange({ moduleKey: 'billing', targetPlanId: p, current: null, currentPlanIsPaid: false }))
    .toMatchObject({ action: 'reject', code: 'PLAN_NOT_SELECTABLE' }));
it('connect has no trial', () =>
  expect(decideZeroPriceChange({ moduleKey: 'connect', targetPlanId: 'connect', current: null, currentPlanIsPaid: false }))
    .toMatchObject({ action: 'reject', code: 'PLAN_NOT_SELECTABLE' }));
```

- [ ] **Step 2: Run** `npx jest tests/lib/subscription/zero-price-change.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `decideZeroPriceChange`** in `lib/subscription/zero-price-change.ts`.
- [ ] **Step 4: Run the rule tests.** Expected: PASS.
- [ ] **Step 5: Write the failing route tests** in `tests/db/billing-money-path.db.test.ts`, calling the exported `POST` of `app/api/subscriptions/upgrade/route.ts` with a `NextRequest` carrying `x-authenticated-business-id` and `x-authenticated-user-id` of a seeded primary admin:

```ts
it('upgrade to connect_free leaves no end date', async () => {
  const res = await upgrade(biz, { plan_id: 'connect_free' });
  expect(res.status).toBe(200);
  expect(await row(biz, 'connect')).toMatchObject({ plan_id: 'connect_free', status: 'active', end_date: null });
});
it('paid business cannot drop to free through upgrade', async () => {
  await setPlan(biz, 'billing', 'billing_business', { end_date: '+300 days' });
  const res = await upgrade(biz, { plan_id: 'free' });
  expect(res.status).toBe(409);
  expect((await res.json()).code).toBe('USE_DOWNGRADE');
  expect((await row(biz, 'billing')).plan_id).toBe('billing_business');
});
it('adding HR starts a real trial row', async () => {
  await upgrade(biz, { plan_id: 'hr_trial' });
  const r = await row(biz, 'hr');
  expect(r.status).toBe('trial');
  expect(r.trial_end_date).not.toBeNull();
  expect(r.end_date).toBeNull();
});
it('second HR trial request is refused', async () => {
  await upgrade(biz, { plan_id: 'hr_trial' });
  const res = await upgrade(biz, { plan_id: 'hr_trial' });
  expect(res.status).toBe(409);
  expect((await res.json()).code).toBe('TRIAL_ALREADY_USED');
});
```

- [ ] **Step 6: Run the suite.** Expected: the four tests FAIL (end date set; 200 instead of 409; status `active`).
- [ ] **Step 7: Rewrite the body of the route after the `amount > 0` block.** Remove the `plan_id === TRIAL_PLAN_ID` early return (rule 2 and 3 replace it). Load the current module row with `getModuleSubscription(business_id, moduleKey, true)` and the current plan's prices; call `decideZeroPriceChange`; on `reject` return status 409 with the code and message; on `apply_free` call `moveModuleSubscriptionToFree` when a row exists, else `upsertModuleSubscription({ query }, business_id, moduleKey, plan_id, 'active', null)`; on `start_trial` call `upsertModuleSubscription(..., 'trial', trialDays)`. In both success paths call `enableBusinessModule(business_id, moduleKey, 'upgrade')` and `clearSubscriptionCache`. Keep the existing response shape.
- [ ] **Step 8: Run the suite and the rule tests.** Expected: PASS.
- [ ] **Step 9: Commit** `lib/subscription/zero-price-change.ts`, the route, both test files.

### Task 2: Tier order that does not depend on price (SUB-01 part 2, SUB-29)

Owner requirement (2026-11-26): for testing, any plan's price may be set to ₹1 in Admin → Plans and buying it must still work. Tier order therefore must not be derived from price.

**Files:**
- Create: `lib/subscription/plan-tier.ts`
- Modify: `lib/subscription/module-plan-lifecycle.ts:22-49`, `lib/subscription/trial-plan.ts:36-60`, `components/subscription/SubscriptionChangePlanModal.tsx:131`
- Test: `tests/lib/subscription/plan-tier.test.ts`, `tests/db/billing-money-path.db.test.ts`

**Interfaces:**
- Produces:

```ts
export type TierPlan = { id: string; sort_order: number };
/** Plans that are the bottom tier of their product whatever their sort_order. */
export const FREE_TIER_PLAN_IDS: ReadonlySet<string>; // 'free', 'hr_free', 'hr_staff_lite', 'connect_free'
/** 0 for a free-tier plan, otherwise sort_order + 1. Price is never read. */
export function planTierRank(plan: TierPlan): number;
/** -1 when a is the lower tier, 1 when higher, 0 when equal. */
export function comparePlanTier(a: TierPlan, b: TierPlan): -1 | 0 | 1;

// lib/subscription/trial-plan.ts, replaces the old signature
export function getPlanChangeAction(current: TierPlan, target: TierPlan): PlanChangeAction;
```

`getPlanChangeAction`: same id → `current`; current is a trial plan → `downgrade` only when the target is a free-tier plan, else `upgrade`; target is a trial plan → `downgrade`; otherwise `upgrade` when `comparePlanTier(target, current) === 1`, else `downgrade`.

- [ ] **Step 1: Write the failing tests**

```ts
it('connect is an upgrade from connect_free', () =>
  expect(getPlanChangeAction({ id: 'connect_free', sort_order: 21 }, { id: 'connect', sort_order: 20 })).toBe('upgrade'));
it('hr_free is a downgrade from hr_pro', () =>
  expect(getPlanChangeAction({ id: 'hr_pro', sort_order: 11 }, { id: 'hr_free', sort_order: 13 })).toBe('downgrade'));
it('hr_pro is an upgrade from hr_staff_lite', () =>
  expect(getPlanChangeAction({ id: 'hr_staff_lite', sort_order: 9 }, { id: 'hr_pro', sort_order: 11 })).toBe('upgrade'));
it('starter is a downgrade from business', () =>
  expect(getPlanChangeAction({ id: 'billing_business', sort_order: 4 }, { id: 'billing_starter', sort_order: 2 })).toBe('downgrade'));
```

and in the database suite:

```ts
it('cannot schedule a higher tier as a downgrade', async () => {
  await setPlan(biz, 'connect', 'connect_free');
  await expect(downgradeModuleSubscription(biz, 'connect', 'connect', { confirmed: true }))
    .rejects.toThrow('not a lower tier');
  expect((await row(biz, 'connect')).scheduled_plan_id).toBeNull();
});
it('cannot schedule a plan that is not on sale', async () => {
  await setPlan(biz, 'billing', 'business', { end_date: '+20 days' }); // Business Classic, sort 31
  await expect(downgradeModuleSubscription(biz, 'billing', 'growth', { confirmed: true })) // Growth Classic, not public
    .rejects.toThrow('not found or inactive');
});
it('a plan priced at 1 rupee is still bought through checkout and keeps its tier', async () => {
  await query(`UPDATE subscription_plans SET price_monthly = 1 WHERE id = 'billing_business'`);
  try {
    await setPlan(biz, 'billing', 'billing_starter', { end_date: '+20 days' });
    const up = await upgrade(biz, { plan_id: 'billing_business' });
    expect(up.status).toBe(402); // REQUIRES_CHECKOUT, not a free switch
    await expect(downgradeModuleSubscription(biz, 'billing', 'billing_business', { confirmed: true }))
      .rejects.toThrow('not a lower tier');
    const pricing = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_business', billingCycle: 'monthly' });
    expect(pricing.finalAmount).toBe(1);
    const tx = await pendingCheckout(biz, 'billing_business', 1);
    await hook('payment.captured', 'pay_one', 'captured', notesFor(biz, tx, 'billing_business'), { amountPaise: 100 });
    expect(await row(biz, 'billing')).toMatchObject({ plan_id: 'billing_business', status: 'active' });
  } finally {
    await query(`UPDATE subscription_plans SET price_monthly = 799 WHERE id = 'billing_business'`);
  }
});
```

The last test's webhook half passes only after Task 5; mark that half `it.todo` until then and enable it in Task 5 step 4.

Also add to `app/api/subscriptions/checkout/route.ts`: when `0 < pricing.finalAmount < 1` (a coupon on a ₹1 plan), answer 400 `{ error: 'The amount after discount is below ₹1. Remove the coupon or use a 100% coupon.', code: 'AMOUNT_BELOW_MINIMUM' }`, with a route test for a 50 % coupon on a ₹1 plan.

- [ ] **Step 2: Run both files.** Expected: FAIL (wrong label; downgrade is scheduled).
- [ ] **Step 3: Implement `plan-tier.ts`, the new `getPlanChangeAction`, the downgrade rule, and the checkout minimum.** In `downgradeModuleSubscription`: throw the existing "not a lower tier" message unless `comparePlanTier(target, current) === -1`; throw the existing "not found or inactive" message when `planOpenToBusiness(businessId, targetPlanId)` is false. Update the one caller in `SubscriptionChangePlanModal.tsx:131` to pass `{ id, sort_order }` objects.
- [ ] **Step 4: Run both files and `npx tsc --noEmit`.** Expected: PASS, no new type errors.
- [ ] **Step 5: Commit** the six files.

### Task 3: The nightly job never starts an unpaid paid period (SUB-05, SUB-28, Review Focus 1)

**Files:**
- Modify: `lib/subscription/lifecycle.ts:344-457`
- Create: `database/migrations/477_free_plan_no_end_date_addon_period.sql`
- Test: `tests/db/billing-money-path.db.test.ts`

**Interfaces:**
- Consumes: `moveModuleSubscriptionToFree`, `getFreePlanIdForModule`.
- Produces: `processExpiredModuleSubscriptions()` keeps its return type. Behaviour change for a due `scheduled_plan_id`:
  - scheduled plan is the module's free plan → `moveModuleSubscriptionToFree(..., 'downgraded')`;
  - scheduled plan has a price → set `plan_id` to it, clear `scheduled_plan_id`, set `downgraded_from`, leave `end_date` unchanged, set `grace_period_end = end_date + 7`. Log event `downgraded` with `details.awaiting_payment = true`.

Every `UPDATE` in the function repeats its selecting condition (`AND end_date < CURRENT_DATE`, `AND scheduled_plan_id = $n`, `AND grace_period_end < CURRENT_DATE`, `AND cancel_at_period_end = true`). `moveModuleSubscriptionToFree` gains an optional last parameter `onlyIf?: 'grace_expired' | 'cancel_due' | 'trial_due'` that adds the matching condition to its `UPDATE` and returns `boolean` (row changed); the job counts only changed rows.

Migration 477, first half:

```sql
UPDATE business_module_subscriptions
   SET end_date = NULL, grace_period_end = NULL, scheduled_plan_id = NULL, updated_at = CURRENT_TIMESTAMP
 WHERE plan_id IN ('free', 'hr_free', 'connect_free', 'hr_staff_lite')
   AND (end_date IS NOT NULL OR grace_period_end IS NOT NULL);
```

- [ ] **Step 1: Write the failing tests**

```ts
it('due downgrade to a cheaper paid plan gets grace, not a new period', async () => {
  await setPlan(biz, 'billing', 'billing_business', { end_date: '-1 day', scheduled_plan_id: 'billing_starter' });
  await processExpiredModuleSubscriptions();
  const r = await row(biz, 'billing');
  expect(r.plan_id).toBe('billing_starter');
  expect(r.end_date).toBe(daysFromToday(-1));
  expect(r.grace_period_end).toBe(daysFromToday(6));
});
it('due downgrade to free lands on free with no end date', async () => {
  await setPlan(biz, 'billing', 'billing_business', { end_date: '-1 day', scheduled_plan_id: 'free' });
  await processExpiredModuleSubscriptions();
  expect(await row(biz, 'billing')).toMatchObject({ plan_id: 'free', end_date: null, grace_period_end: null });
});
it('a payment that lands before the update is not overwritten', async () => {
  await setPlan(biz, 'billing', 'billing_growth', { end_date: '-9 days', grace_period_end: '-1 day' });
  // simulate the payment between select and update
  await applyModuleSubscriptionPlanChange({ businessId: biz, moduleKey: 'billing', planId: 'billing_growth', billingCycle: 'monthly' });
  const changed = await moveModuleSubscriptionToFree(biz, 'billing', 'billing_growth', 'grace_expired', 'grace_expired');
  expect(changed).toBe(false);
  expect((await row(biz, 'billing')).plan_id).toBe('billing_growth');
});
it('migration 477 clears end dates on free plans', async () => {
  await setPlan(biz, 'billing', 'free', { end_date: '-1 day' });
  await query(readFileSync('database/migrations/477_free_plan_no_end_date_addon_period.sql', 'utf8'));
  expect((await row(biz, 'billing')).end_date).toBeNull();
  expect((await getOperationalModuleSubscriptions(biz, true)).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run.** Expected: FAIL (end date moved a month; plan overwritten; file missing).
- [ ] **Step 3: Implement the job changes, the `onlyIf` parameter, and the first half of migration 477.**
- [ ] **Step 4: Run the suite and `tests/db/module-subscription-sole-source.db.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit** `lifecycle.ts`, `module-plan-lifecycle.ts`, the migration, the test file.

### Task 4: A failed attempt does not close the checkout (SUB-02, Review Focus 2)

**Files:**
- Modify: `lib/platform-billing-transaction-state.ts:28-67`, `lib/platform-billing.ts:576-598,675-679`, `tests/lib/billing-transaction-state.test.ts:22-27`
- Test: `tests/db/billing-money-path.db.test.ts`

**Interfaces:**
- Produces: allowed transitions are `pending → completed`, `pending → failed`, `failed → completed`. All others throw as today.
- Razorpay `failed` branch in `processPlatformRazorpayWebhook`: only `verified.eventType` `payment_link.cancelled` or `payment_link.expired` marks the row `failed`. `payment.failed` leaves the row `pending`, sends no email or WhatsApp, logs `logSubscriptionEvent(businessId, 'payment_attempt_failed', { transaction_id })`, and sets the webhook event row to status `processed` with note `Attempt failed; checkout still open`.
- `payment_link.expired` is detected in the platform code from `verified.eventType`; the shared provider's status mapping is not changed.
- Easebuzz: `settledOutcome` short-circuits only when the row is `completed`.

- [ ] **Step 1: Change the existing unit test** "blocks failed → completed" to "allows failed → completed" (`not.toThrow()`), and add "blocks completed → failed" (`toThrow(BillingTransactionStateError)`).
- [ ] **Step 2: Write the failing database tests** (helper `hook(event, payId, payStatus, notes)` builds and signs a Razorpay body and calls `processPlatformRazorpayWebhook`):

```ts
it('failed attempt then captured payment activates the plan', async () => {
  const tx = await pendingCheckout(biz, 'billing_growth', 499);
  const notes = { business_id: biz, billing_transaction_id: tx, plan_id: 'billing_growth', billing_cycle: 'monthly' };
  expect(await hook('payment.failed', 'pay_f1', 'failed', notes)).toEqual({ ok: true });
  expect((await txRow(tx)).status).toBe('pending');
  expect(await hook('payment.captured', 'pay_ok1', 'captured', notes)).toEqual({ ok: true });
  expect((await txRow(tx)).status).toBe('completed');
  expect(await row(biz, 'billing')).toMatchObject({ plan_id: 'billing_growth', status: 'active' });
});
it('success after the link was cancelled still activates', async () => {
  const tx = await pendingCheckout(biz, 'billing_growth', 499);
  const notes = { business_id: biz, billing_transaction_id: tx, plan_id: 'billing_growth', billing_cycle: 'monthly' };
  await hook('payment_link.cancelled', 'plink_c1', 'cancelled', notes);
  expect((await txRow(tx)).status).toBe('failed');
  await hook('payment.captured', 'pay_ok2', 'captured', notes);
  expect((await row(biz, 'billing')).plan_id).toBe('billing_growth');
});
```

- [ ] **Step 3: Run both files.** Expected: FAIL ("Checkout transaction is already failed").
- [ ] **Step 4: Implement** the transition table, the Razorpay failed branch, the Easebuzz short-circuit, and in `completeSubscriptionCheckoutPayment` accept `tx.status` of `pending` or `failed`.
- [ ] **Step 5: Run both files plus `tests/lib/platform-billing-webhook.test.ts` and `tests/lib/platform-billing-easebuzz.test.ts`.** Expected: PASS (adjust the Easebuzz suite's "failure marks failed" case only if it asserted the short-circuit).
- [ ] **Step 6: Commit** the three source files and the two test files.

### Task 5: Completion is one transaction and events can be reprocessed (SUB-03, SUB-27, SUB-26 amount check, Review Focus 3)

**Files:**
- Modify: `lib/subscription/apply-module-plan-change.ts:28-104`, `lib/platform-subscription-checkout.ts:413-549`, `lib/platform-billing.ts:452-613,663-719`
- Test: `tests/db/billing-money-path.db.test.ts`

**Interfaces:**
- Produces:

```ts
// apply-module-plan-change.ts: new optional last argument
export async function applyModuleSubscriptionPlanChange(
  params: { businessId: string; moduleKey: PlatformModule; planId: string; billingCycle: BillingCycle; paymentMethod?: string; paymentReference?: string | null },
  client?: PoolClient,
): Promise<ApplyModulePlanChangeResult>;

// platform-subscription-checkout.ts: return value replaces void
export type CheckoutCompletion = 'activated' | 'already_completed';
export async function completeSubscriptionCheckoutPayment(params: /* unchanged, plus */ { amount: number }): Promise<CheckoutCompletion>;

// platform-billing.ts
export async function logPlatformWebhookEvent(params: /* unchanged */): Promise<{ isNew: boolean; status: string }>;
```

- `completeSubscriptionCheckoutPayment`: `getPool().connect()`, `BEGIN`, `SELECT … FROM billing_transactions WHERE id = $1 AND business_id = $2 FOR UPDATE`. Status `completed` → `ROLLBACK`, return `already_completed`. Paid amount in paise must equal `total_amount` in paise, else throw `Error('AMOUNT_MISMATCH')`. Then, on the same client: set status `completed` and `payment_reference`, call `applyModuleSubscriptionPlanChange(params, client)`, insert the coupon redemption (Task 8 extends this), `COMMIT`. Plan and billing cycle come from the locked row, not from webhook notes. Emails, admin notice and partner commission run after `COMMIT`, each in its own `try/catch`.
- When `client` is given, `applyModuleSubscriptionPlanChange` runs its `SELECT` and `INSERT … ON CONFLICT` on it; `enableBusinessModule`, HR bundle, cache clearing and the event log stay after the caller's commit, so move those four calls into an exported `afterPlanChangeCommitted(result, meta)` that the caller invokes. Without `client` the function behaves as today and calls `afterPlanChangeCommitted` itself.
- Webhook processing: an event is processed when `isNew` or when the stored status is `received` or `error`. On any thrown error set the event row to status `error` with the message in `processing_notes`, then rethrow. `already_completed` sets status `processed` with note `Duplicate of a completed checkout` and returns `{ ok: true, duplicate: true }`. `AMOUNT_MISMATCH` sets status `ignored` and returns `{ ok: false, error: 'Amount mismatch' }` (route answers 401 today for `ok:false`; change that branch to 422 in `app/api/webhooks/platform-billing/razorpay/route.ts:181-185`).

- [ ] **Step 1: Write the failing tests**

```ts
it('captured and link-paid at the same instant activate once', async () => {
  const coupon = await makeCoupon({ type: 'percentage', value: 10, max_redemptions: 5 });
  const tx = await pendingCheckout(biz, 'billing_growth', 499, { couponId: coupon, discount: 49.9 });
  const notes = { business_id: biz, billing_transaction_id: tx, plan_id: 'billing_growth', billing_cycle: 'monthly' };
  const results = await Promise.all([
    hook('payment.captured', 'pay_r1', 'captured', notes, { amountPaise: 44910 }),
    hook('payment_link.paid', 'pay_r1', 'captured', notes, { amountPaise: 44910, withLink: true }),
  ]);
  expect(results.every((r) => r.ok)).toBe(true);
  expect(await count(`coupon_redemptions WHERE coupon_id = $1`, [coupon])).toBe(1);
  expect(await count(`subscription_events WHERE business_id = $1 AND event_type = 'upgraded'`, [biz])).toBe(1);
});
it('a failure during activation leaves the payment pending and the event retryable', async () => {
  const tx = await pendingCheckout(biz, 'billing_growth', 499);
  const notes = { business_id: biz, billing_transaction_id: tx, plan_id: 'billing_growth', billing_cycle: 'monthly' };
  const spy = jest.spyOn(planChange, 'applyModuleSubscriptionPlanChange').mockRejectedValueOnce(new Error('boom'));
  await expect(hook('payment.captured', 'pay_e1', 'captured', notes)).rejects.toThrow('boom');
  expect((await txRow(tx)).status).toBe('pending');
  spy.mockRestore();
  expect(await hook('payment.captured', 'pay_e1', 'captured', notes)).toEqual({ ok: true });
  expect((await row(biz, 'billing')).plan_id).toBe('billing_growth');
});
it('wrong amount does not activate', async () => {
  const tx = await pendingCheckout(biz, 'billing_growth', 499);
  const notes = { business_id: biz, billing_transaction_id: tx, plan_id: 'billing_growth', billing_cycle: 'monthly' };
  const r = await hook('payment.captured', 'pay_a1', 'captured', notes, { amountPaise: 100 });
  expect(r).toMatchObject({ ok: false, error: 'Amount mismatch' });
  expect(await row(biz, 'billing')).toBeNull();
});
it('plan comes from the stored row, not from notes', async () => {
  const tx = await pendingCheckout(biz, 'billing_starter', 299);
  await hook('payment.captured', 'pay_n1', 'captured',
    { business_id: biz, billing_transaction_id: tx, plan_id: 'billing_business', billing_cycle: 'three_year' }, { amountPaise: 29900 });
  expect(await row(biz, 'billing')).toMatchObject({ plan_id: 'billing_starter', billing_cycle: 'monthly' });
});
```

- [ ] **Step 2: Run.** Expected: FAIL (second delivery throws; status `completed` after the forced error; retry returns duplicate; activation on wrong amount; plan taken from notes).
- [ ] **Step 3: Implement** the client parameter and `afterPlanChangeCommitted`, the transactional completion, the event states, and the 422 branch.
- [ ] **Step 4: Run the suite plus the two existing webhook suites.** Expected: PASS. The mocked webhook suite needs its `logPlatformWebhookEvent` mock to return `{ isNew, status }`.
- [ ] **Step 5: Commit** the four source files and the test files.

### Task 6: Daily report of payments recorded but not applied (SUB-03)

**Files:**
- Create: `lib/subscription/reconcile-payments.ts`
- Modify: `app/api/cron/check-subscriptions/route.ts:10-13,81-88`
- Test: `tests/db/billing-money-path.db.test.ts`

**Interfaces:**
- Produces:

```ts
export type UnappliedPayment = { billing_transaction_id: string; business_id: string; module_key: string; plan_id: string; paid_at: string };
export type StuckWebhookEvent = { id: string; provider: string; event_type: string; status: string; created_at: string };
export async function findUnappliedPayments(): Promise<UnappliedPayment[]>;
export async function findStuckWebhookEvents(): Promise<StuckWebhookEvent[]>;
export async function reportBillingAnomalies(): Promise<{ unapplied: number; stuckEvents: number }>;
```

- `findUnappliedPayments`: `billing_transactions` with `type='payment'`, `status='completed'`, `total_amount > 0`, `updated_at` in the last 35 days, `gateway_response->>'checkout_type' = 'subscription'`, that are the latest completed payment for their `(business_id, module_key)`, where the module row is missing or its `plan_id` differs and its `updated_at` is older than the payment.
- `findStuckWebhookEvents`: `platform_billing_webhook_events` with status `received` or `error` older than 10 minutes, last 35 days.
- `reportBillingAnomalies`: when either list is non-empty, one `sendPlatformAdminPush({ event: 'incident', title: 'Billing: payments need attention', body: '<n> paid but not applied, <m> webhook events stuck', url: '/admin/billing' })` and one `console.error` line per item. It changes no data.
- The cron summary gains `billingAnomalies: { unapplied, stuckEvents }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('finds a completed payment whose plan was never applied', async () => {
  const tx = await pendingCheckout(biz, 'billing_growth', 499);
  await query(`UPDATE billing_transactions SET status = 'completed' WHERE id = $1`, [tx]);
  expect((await findUnappliedPayments()).map((p) => p.billing_transaction_id)).toContain(tx);
});
it('does not report a payment that was applied', async () => {
  const tx = await paidAndActivated(biz, 'billing_growth');
  expect((await findUnappliedPayments()).map((p) => p.billing_transaction_id)).not.toContain(tx);
});
it('does not report an older payment superseded by a later plan change', async () => {
  const old = await paidAndActivated(biz, 'billing_starter');
  await paidAndActivated(biz, 'billing_growth');
  expect((await findUnappliedPayments()).map((p) => p.billing_transaction_id)).not.toContain(old);
});
```

- [ ] **Step 2: Run.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement the three functions and call `reportBillingAnomalies` from the cron.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** the two source files and the test file.

### Task 7: The AI add-on has a paid period (SUB-04, Review Focus 5)

**Files:**
- Modify: `lib/platform-addon-checkout.ts:58-97`, `app/api/subscriptions/addons/[type]/purchase/route.ts:72-87`, `lib/subscription/lifecycle.ts` (end of `processExpiredModuleSubscriptions`), `database/migrations/477_free_plan_no_end_date_addon_period.sql`
- Test: `tests/db/billing-money-path.db.test.ts`

**Interfaces:**
- `activateWhatsAppAddon(businessId, addonType, price)`: one upsert on `(business_id, addon_type)` setting `status = 'active'` and `end_date = GREATEST(COALESCE(existing end_date, CURRENT_DATE), CURRENT_DATE) + INTERVAL '1 month'`; `start_date` is set only on insert or when the existing row was not active.
- Purchase route: the `ALREADY_ACTIVE` refusal is removed, so a second payment extends the period.
- `ModuleExpiredSubscriptionCounts` gains `addonsExpired: number`. The job runs `UPDATE whatsapp_addons SET status = 'expired' WHERE status = 'active' AND end_date IS NOT NULL AND end_date < CURRENT_DATE`, then `clearAddonCache` for each affected business.
- Migration 477, second half (existing buyers get 30 days from the day it is applied):

```sql
UPDATE whatsapp_addons
   SET end_date = (CURRENT_DATE + INTERVAL '30 days')::date, updated_at = CURRENT_TIMESTAMP
 WHERE addon_type = 'khatario_ai' AND status = 'active' AND end_date IS NULL;
```

- [ ] **Step 1: Write the failing tests**

```ts
it('first payment gives one month', async () => {
  await completeAddonCheckoutPayment({ businessId: biz, addonType: 'khatario_ai', billingTransactionId: await pendingCheckout(biz, 'connect', 299), providerPaymentId: 'pay_ai1', amount: 299 });
  expect((await addon(biz)).end_date).toBe(monthsFromToday(1));
});
it('second payment extends from the current end date', async () => {
  await payAddon(biz); await payAddon(biz);
  expect((await addon(biz)).end_date).toBe(monthsFromToday(2));
});
it('job expires an ended add-on and the quota drops', async () => {
  await payAddon(biz);
  await query(`UPDATE whatsapp_addons SET end_date = CURRENT_DATE - 1 WHERE business_id = $1`, [biz]);
  const counts = await processExpiredModuleSubscriptions();
  expect(counts.addonsExpired).toBeGreaterThanOrEqual(1);
  expect((await addon(biz)).status).toBe('expired');
  expect(await khatarioMonthlyQuota(biz)).toBe(0);
});
```

- [ ] **Step 2: Run.** Expected: FAIL (`end_date` null).
- [ ] **Step 3: Implement** the upsert, the route change, the job step, and the migration's second half.
- [ ] **Step 4: Run the suite and `tests/db/plan-catalog-v2.db.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit** the four source files and the test file.

### Task 8: Free-month coupons are honoured after payment (SUB-16)

**Files:**
- Modify: `lib/platform-subscription-checkout.ts` (inside the Task 5 transaction), `lib/subscription/coupons.ts:163-210`, `lib/subscription/apply-module-plan-change.ts:107-126`
- Test: `tests/db/billing-money-path.db.test.ts`

**Interfaces:**
- Consumes: the transaction client from Task 5.
- Produces:

```ts
export async function redeemCoupon(
  couponId: string, businessId: string, planId: string,
  billingTransactionId: string, billingCycle: BillingCycle, client?: PoolClient,
): Promise<{ type: Coupon['type']; value: number; discount_amount: number }>;

export async function extendModuleSubscriptionForFreeMonths(
  businessId: string, moduleKey: PlatformModule, freeMonths: number, client?: PoolClient,
): Promise<void>;
```

- `redeemCoupon`: `billingTransactionId` is required; the stored `discount_amount` uses `computePlanAmount(plan, billingCycle)`; the insert uses `ON CONFLICT (coupon_id, business_id, billing_transaction_id) DO NOTHING` and the counter is incremented only when a row was inserted. Update both callers (`platform-subscription-checkout.ts`, `apply-coupon-upgrade.ts`).
- After the plan change in the completion transaction: when the redeemed coupon's type is `free_months`, call `extendModuleSubscriptionForFreeMonths(businessId, moduleKey, value, client)`.

- [ ] **Step 1: Write the failing tests**

```ts
it('3 free months extend a paid monthly checkout to 4 months', async () => {
  const coupon = await makeCoupon({ type: 'free_months', value: 3 });
  const tx = await pendingCheckout(biz, 'billing_growth', 499, { couponId: coupon });
  await hook('payment.captured', 'pay_fm1', 'captured', notesFor(biz, tx, 'billing_growth'), { amountPaise: 49900 });
  expect((await row(biz, 'billing')).end_date).toBe(monthsFromToday(4));
});
it('yearly percentage coupon records the yearly discount', async () => {
  const coupon = await makeCoupon({ type: 'percentage', value: 10 });
  const tx = await pendingCheckout(biz, 'billing_growth', 4499, { couponId: coupon, discount: 449.9, cycle: 'yearly' });
  await hook('payment.captured', 'pay_y1', 'captured', notesFor(biz, tx, 'billing_growth', 'yearly'), { amountPaise: 404910 });
  expect(Number((await redemption(coupon)).discount_amount)).toBe(449.9);
});
```

- [ ] **Step 2: Run.** Expected: FAIL (end date one month out; discount 49.9).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the suite.** Expected: PASS, including the Task 5 "activate once" test.
- [ ] **Step 5: Commit** the three source files, `apply-coupon-upgrade.ts`, and the test file.

### Task 9: Checkouts and payment links expire (SUB-26)

**Files:**
- Modify: `lib/payments/types.ts` (`CreateUpiCollectParams`), `lib/payments/providers/razorpay-payment-provider.ts:80-99`, `lib/platform-subscription-checkout.ts:300-336`, `lib/platform-addon-checkout.ts:131-150`, `lib/platform-billing.ts:206-248`, `lib/subscription/lifecycle.ts`
- Test: `tests/db/billing-money-path.db.test.ts`, `tests/lib/razorpay-webhook-verify.test.ts` (new case in the same file)

**Interfaces:**
- `CreateUpiCollectParams` gains `expiresAt?: Date`. The Razorpay provider sends `expire_by` (Unix seconds) only when it is set. Both platform checkouts pass `expiresAt = now + 24 hours`. Tenant flows pass nothing and are unchanged.
- `updateBillingTransactionStatus(id, status, gatewayResponse?, options?: { notify?: boolean })`; `notify: false` skips `dispatchBillingEmails`.
- `ModuleExpiredSubscriptionCounts` gains `checkoutsExpired: number`. The job selects `billing_transactions` with `status = 'pending'`, `payment_method IN ('razorpay','easebuzz')`, `created_at < NOW() - INTERVAL '48 hours'`, and sets each to `failed` with `{ notify: false }` and `description = COALESCE(description,'') || ' (checkout expired)'`.
- A later verified success still activates, through the `failed → completed` transition from Task 4.

- [ ] **Step 1: Write the failing tests**

```ts
it('razorpay link carries an expiry when asked', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'plink_x', short_url: 'https://rzp.io/x' })));
  const expiresAt = new Date('2027-01-01T00:00:00Z');
  await new RazorpayPaymentProvider({ clientId: 'rzp_test_x', clientSecret: 'k' })
    .createHostedPaymentLink({ businessId: 'b', orderId: 'o', amount: 499, expiresAt });
  expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).expire_by).toBe(Math.floor(expiresAt.getTime() / 1000));
});
it('job closes a 3-day-old pending checkout without emailing', async () => {
  const tx = await pendingCheckout(biz, 'billing_growth', 499);
  await query(`UPDATE billing_transactions SET created_at = NOW() - INTERVAL '3 days' WHERE id = $1`, [tx]);
  const counts = await processExpiredModuleSubscriptions();
  expect(counts.checkoutsExpired).toBeGreaterThanOrEqual(1);
  expect((await txRow(tx)).status).toBe('failed');
  expect(sendPlatformEmail).not.toHaveBeenCalled();
});
it('a fresh pending checkout is left alone', async () => {
  const tx = await pendingCheckout(biz, 'billing_growth', 499);
  await processExpiredModuleSubscriptions();
  expect((await txRow(tx)).status).toBe('pending');
});
it('payment after expiry still activates', async () => {
  const tx = await pendingCheckout(biz, 'billing_growth', 499);
  await query(`UPDATE billing_transactions SET created_at = NOW() - INTERVAL '3 days' WHERE id = $1`, [tx]);
  await processExpiredModuleSubscriptions();
  await hook('payment.captured', 'pay_late', 'captured', notesFor(biz, tx, 'billing_growth'), { amountPaise: 49900 });
  expect((await row(biz, 'billing')).plan_id).toBe('billing_growth');
});
```

- [ ] **Step 2: Run both files.** Expected: FAIL (`expire_by` undefined; row stays pending; `checkoutsExpired` undefined).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the whole suite, then every subscription suite:**

```bash
npx jest tests/lib/subscription tests/lib/platform-billing-webhook.test.ts tests/lib/platform-billing-easebuzz.test.ts tests/lib/billing-transaction-state.test.ts tests/lib/razorpay-webhook-verify.test.ts tests/security/require-operational-subscription.test.ts --runInBand --forceExit
```

and the database suites `billing-money-path`, `module-subscription-sole-source`, `plan-catalog-v2`, `billing-plan-ladder`. Expected: all PASS. Then `npx tsc --noEmit`: no new errors against the baseline in `tsc-errors.txt`.

- [ ] **Step 5: Commit** the six source files and the test files; append the `docs/project.log.md` entry and a row for this plan's results in `docs/qa/README.md`.

---

## After the last task

1. Staging check, owner approval needed first: apply migration 477 on staging, then in Razorpay **test mode** make one payment that fails once and succeeds on retry, and confirm the plan activates. This is the one behaviour the audit simulated and did not observe.
2. Staging API checks as an owner: `POST /api/subscriptions/upgrade {"plan_id":"connect_free"}` then `POST /api/subscriptions/downgrade {"target_plan_id":"connect","confirmed":true}` must answer 400 "not a lower tier".
3. Tell existing Khatario AI add-on buyers that the add-on now ends 30 days after the migration unless renewed (migration 477, Task 7). Owner decides the wording, or a different date.

## Owner decisions inside this plan

| Task | Decision taken here | Alternative |
| --- | --- | --- |
| 1 | An HR-first business adding Billing gets the 30-day Billing trial once (today the request is refused). | Keep refusing; say so and rule 2 becomes HR-only. |
| 3 | A due downgrade to a cheaper paid plan gives 7 days of grace on that plan, then Free. | Go straight to Free at period end. |
| 4 | No email or WhatsApp for a single failed attempt. | Keep the failure message. |
| 7 | Existing AI add-ons end 30 days after the migration. | Another date, or end at once. |
| 9 | Links expire after 24 hours; unpaid checkouts close after 48. | Other durations. |
