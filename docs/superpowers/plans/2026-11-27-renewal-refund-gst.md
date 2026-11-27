# Renewal, Refund and GST Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give paying customers a working renewal (no lost days, no lockout, reminders before expiry), give the platform a working refund, and give subscription payments a tax line and invoice number that the owner can switch on: audit findings SUB-06, SUB-07, SUB-11, SUB-13, SUB-37 and SUB-44.

**Architecture:** Period arithmetic moves into one SQL-backed function so renewals extend from the current end date and upgrades get credit for unused paid time, using the paid period now recorded on each payment row. Grace is computed from the end date instead of waiting for the nightly job. Refunds become their own payment rows that call the gateway and optionally end the plan. GST is a platform setting with three modes whose default leaves every charge exactly as it is today.

**Tech Stack:** Next.js route handlers and React components (TypeScript), PostgreSQL, Jest with real-database suites on `kh_phase2_test`.

**Spec:** `docs/qa/subscription-billing-audit-2026-11-26.md`, section D, findings SUB-06, 07, 11, 13, 37, 44.

**Not in this plan:** automatic card or UPI mandate renewal (no stored mandate exists); a downloadable PDF invoice (an HTML receipt page is in scope); partial plan refunds with pro-rata entitlement changes.

## Global Constraints

- Tests and migrations run only on the local disposable database `kh_phase2_test`. Migration files are written, never applied to staging or production; in tests a migration runs as SQL text.
- No real gateway call in any test: stub `global.fetch`.
- **With the default settings, every amount charged is identical to today.** GST mode defaults to `none`; credit for unused time only ever lowers a charge.
- Any plan priced at ₹1 or more must work end to end; no rule reads price to decide a plan's tier. A charge below ₹1 after credits is raised to ₹1 (gateway minimum), never refused.
- The rules of the earlier fix plans stay in force: completion is one transaction with the checkout row locked, plan and cycle from the stored row, amount checked in paise, `already_completed` for a repeat, terminal errors ignored, others retried; failure writes guarded by status; every nightly-job update repeats its selecting condition.
- Dates are calendar dates computed in SQL (`CURRENT_DATE`, `make_interval`), not in JavaScript.
- New database tests go in `tests/db/renewal-refund-gst.db.test.ts`, with header and helpers modelled on `tests/db/billing-money-path.db.test.ts`.
- User-facing text is plain English, no blame, and says what happens to the customer's money and days.
- Stage files by name; the controller commits after each task's review.

## Review Focus

1. **A customer who renews on the last day, the day after, and during grace**: last day → new period starts where the old one ends; after expiry → starts today; in every case no paid day is lost and none is given twice. Pinned in Task 1.
2. **An upgrade whose credit exceeds the new price** (yearly Business with 11 months left moving to a monthly plan of a higher tier): the charge is ₹1, not zero and not negative, and the credit used is recorded. Pinned in Task 2.
3. **A payment made before periods were recorded** (no `period_start`): renewal and upgrade still work; that payment simply earns no credit. Pinned in Task 2.
4. **A refund the gateway refuses or that times out**: nothing is marked refunded, the plan is unchanged, and the admin sees why. Pinned in Task 5.
5. **GST mode switched while a checkout is open**: the customer pays exactly the amount shown when the link was created; the tax recorded matches that amount. Pinned in Task 6.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/subscription/period.ts` (new) | Decide the new period for a payment: renew, upgrade or fresh start |
| `lib/subscription/apply-module-plan-change.ts` | Use `period.ts`; stop computing dates in JavaScript |
| `lib/subscription/upgrade-credit.ts` (new) | Unused value of the current paid period |
| `lib/subscription/checkout-pricing.ts`, `lib/platform-subscription-checkout.ts` | Credit and tax in the price; recorded on the payment row |
| `lib/subscription/module-operational-check.ts`, `effective-plan.ts`, `lifecycle.ts` | Grace computed from the end date |
| `lib/subscription/notifications.ts`, `app/api/subscriptions/current/route.ts` | Renewal reminders; honest `auto_renew` |
| `lib/platform-refunds.ts` (new), `app/api/admin/businesses/[id]/billing/[txId]/refund/route.ts`, `lib/platform-billing.ts` | Refund rows, gateway call, refund webhooks |
| `lib/platform-tax.ts` (new), `database/migrations/480_subscription_tax_and_refunds.sql` (new), admin settings route and screen | GST mode, rate, invoice numbers |
| `app/api/subscriptions/billing-history/[id]/receipt/route.ts` (new) | HTML receipt |
| `components/settings/ModuleSubscriptionCard.tsx`, `components/subscription/SubscriptionChangePlanModal.tsx`, `components/settings/SubscriptionTab.tsx`, `components/admin/BusinessAdminPanel.tsx` | Renew button, grace state, credit and tax shown, receipt link, refund control |

---

### Task 1: Renewing extends the paid period; nothing is computed in JavaScript (SUB-07, SUB-37)

**Files:** create `lib/subscription/period.ts`; modify `lib/subscription/apply-module-plan-change.ts`, `lib/subscription/apply-plan-change.ts` (remove `computeSubscriptionPeriodEnd` once unused); tests in `tests/db/renewal-refund-gst.db.test.ts`.

**Interfaces:**

```ts
export type PeriodKind = 'renewal' | 'change' | 'fresh';
export type NewPeriod = { kind: PeriodKind; startDate: string; endDate: string };
/** Runs one SQL statement on the given client (or pool) and returns calendar dates as YYYY-MM-DD. */
export async function resolveNewPeriod(input: {
  current: { plan_id: string; status: string; start_date: string | null; end_date: string | null; trial_end_date: string | null } | null;
  targetPlanId: string;
  billingCycle: BillingCycle;          // monthly 1, yearly 12, three_year 36 months
  currentPlanIsPaid: boolean;
}, client?: PoolClient): Promise<NewPeriod>;
```

Rules:
- `renewal`: same plan, current plan paid, status `active`, `end_date` today or later → `startDate` = current `start_date`, `endDate` = current `end_date` + cycle months.
- `change`: a different plan, or a paid plan whose `end_date` has passed (including grace) → `startDate` = today, `endDate` = today + cycle months. Unused trial days are added as before when the current plan is a trial.
- `fresh`: no row → today, today + cycle months.
- Month arithmetic is PostgreSQL's (`date + make_interval(months => n)`), so 31 January + 1 month = 28 or 29 February.
- `applyModuleSubscriptionPlanChange` calls it on its transaction client and writes the returned dates; the subscription event records `period_kind`.

Tests (each a real payment through the webhook helper unless noted):
- early renewal 10 days before the end → end moves out by exactly one month from the old end; start unchanged; the second payment row's recorded period starts at the old end and ends at the new end.
- renewal on the last day → same rule; renewal the day after the end (in grace) → period is today to today + 1 month.
- yearly then monthly renewal of the same plan → end = old end + 1 month, `billing_cycle` becomes monthly.
- different plan → `change`; free months from a coupon are added after the base period as today.
- month end: with the current end date 31 January, a monthly renewal ends 28 February (set dates directly, call `resolveNewPeriod`).
- a purchase at 02:00 IST is dated by the database's `CURRENT_DATE` (assert the function returns the database's date, not a JavaScript date).

### Task 2: An upgrade gets credit for unused paid time (SUB-07)

**Files:** create `lib/subscription/upgrade-credit.ts`; modify `lib/subscription/checkout-pricing.ts`, `lib/platform-subscription-checkout.ts` (store and verify), `app/api/subscriptions/checkout/route.ts` (return the breakdown); tests in the same DB file.

**Interfaces:**

```ts
export type UpgradeCredit = { amount: number; fromTransactionId: string | null; unusedDays: number; periodDays: number };
/** Credit = paid total of the payment whose recorded period covers today × unused days ÷ period days, rounded down to paise. Zero when no such payment, when the target is the same plan, or when the target is not a higher tier. */
export async function computeUpgradeCredit(businessId: string, moduleKey: PlatformModule, targetPlanId: string, client?: PoolClient): Promise<UpgradeCredit>;
```

- `CheckoutPricingResult` gains `creditAmount` and `creditFromTransactionId`; `finalAmount` = base − coupon discount − credit, and when that is below ₹1 while base − coupon is at least ₹1 it is set to ₹1 and `creditAmount` is reduced to match.
- Tier comparison uses `comparePlanTier` from `lib/subscription/plan-tier.ts`.
- The pending payment row stores the credit in `metadata` (`{ "upgrade_credit": { amount, from_transaction_id, unused_days, period_days } }`) and `total_amount` is the amount to charge. A payment that has been used as a credit source is marked in its own `metadata` (`credit_consumed_by`) when the upgrade completes, inside the completion transaction, and can never be a credit source again.
- A same-plan renewal and a downgrade never get credit.

Tests: Starter monthly paid 10 days ago (30-day period) → Growth monthly: credit = 299 × 20 ÷ 30 = 199.33, charge 299.67; yearly Business with 11 months left → Connect is another product: no credit; credit larger than price → charge ₹1 and recorded credit = price − 1; payment with no recorded period → credit 0; credit source cannot be reused after a second upgrade; the webhook amount check passes for the credited amount and fails for the uncredited one; coupon and credit combine (coupon first).

### Task 3: Grace starts at expiry, not at the nightly job (SUB-11)

**Files:** modify `lib/subscription/module-operational-check.ts`, `lib/subscription/effective-plan.ts`, `lib/subscription/lifecycle.ts` (lapse and grace-expiry steps); tests in the same DB file plus `tests/security/require-operational-subscription.test.ts` adjustments.

**Interfaces:**
- `GRACE_DAYS = 7` exported from `lib/subscription/effective-plan.ts`.
- `isPaidGracePeriodActive(sub)`: true when `grace_period_end` is today or later, **or** when `grace_period_end` is null, the row is `active`, not `cancel_at_period_end`, has no `scheduled_plan_id`, and `end_date` + 7 days is today or later.
- `isModuleSubscriptionOperational` uses it, so an active paid row is operational from the day after `end_date` without the nightly job.
- The nightly job still stamps `grace_period_end = end_date + 7` (for notifications and reporting) and moves to free when `end_date + 7` has passed even if the stamp is missing.
- A cancelled-at-period-end row and a row with a scheduled downgrade keep today's behaviour.

Tests: the day after `end_date` with no stamp → operational, entitlement is the paid plan; day 8 with no stamp → not operational until the job runs, and the job moves it to free in one run; cancel-at-period-end row the day after → not operational (unchanged); the recurring-invoice job generates for a business the day after its period ends (interaction with the plan-enforcement work).

### Task 4: Renewal reminders and an honest renewal flag (SUB-11, SUB-44)

**Files:** modify `lib/subscription/notifications.ts`, `app/api/subscriptions/current/route.ts`, `app/api/subscriptions/modules/current/route.ts`, add `app/api/subscriptions/cancel/undo/route.ts`; tests in the same DB file and `tests/lib/subscription/lifecycle-notifications.test.ts`.

**Interfaces:**
- New notification types `renewal_due_7`, `renewal_due_3`, `renewal_due_1`, `renewal_lapsed`: sent for paid, active, not-cancelled module rows whose `end_date` is 7, 3, 1 days ahead, and on the first day after `end_date`. Once per type per business per period (the existing `subscription_notifications` uniqueness). Channels as the trial reminders use. Text: "Your {plan} plan for {business} ends on {date}. Renew before then to keep your current period running without a break. If you do nothing, you keep full access for 7 more days and then move to the Free plan. Your data stays safe."
- `current` routes return `auto_renew: false`, `renews_on: null`, `ends_on`, `grace_ends_on`, `in_grace: boolean`, `can_renew: boolean`.
- `POST /api/subscriptions/cancel/undo` (owner only, same guard as cancel): clears `cancel_at_period_end` and `cancelled_at` when the period has not ended; 400 `NOT_CANCELLED` otherwise.

Tests: each reminder sent once at the right offset and not for free, trial, cancelled or lapsed rows; undo-cancel before the end restores the row and after the end is refused; `current` shows `in_grace` with the computed grace end.

### Task 5: Refunds that reach the gateway and can end the plan (SUB-06)

**Files:** create `lib/platform-refunds.ts`; modify the admin refund route, `lib/platform-billing.ts` (Razorpay refund events), `lib/platform-billing-transaction-state.ts`; migration 480 (refund columns); tests in the same DB file.

**Interfaces:**

```ts
export type RefundRequest = { businessId: string; transactionId: string; adminId: string; amount?: number; endPlan: 'now' | 'period_end'; notes?: string };
export type RefundResult = { refundTransactionId: string; status: 'processed' | 'pending'; refundedTotal: number; fullyRefunded: boolean };
export async function refundPlatformPayment(req: RefundRequest): Promise<RefundResult>;
```

- A refund is a new `billing_transactions` row: `type = 'refund'`, `status` `pending` then `completed`, `amount` and `total_amount` the refunded amount, `metadata.refund_of` the original id, `payment_reference` the gateway refund id. The original row stays `completed` until the refunds against it add up to its `total_amount`, then becomes `refunded` (the state table gains `completed → refunded`).
- Amount defaults to the full remaining amount; it may not exceed it; the minimum is ₹1.
- Gateway: Razorpay `refundCapturedPayment` with the original payment id and an idempotency key derived from the refund row id; Easebuzz `refundPayment` with the id from the original row's stored gateway response. `manual`/`coupon` payments are recorded without a gateway call.
- Order: create the pending refund row and commit; call the gateway; on success mark it and apply `endPlan`; on a definite refusal mark it `failed` with the reason and change nothing else; on a timeout or unknown error leave it `pending` (a later `refund.processed` / `refund.failed` webhook or a retry settles it).
- `endPlan: 'now'` moves the module to its free plan (`moveModuleSubscriptionToFree(…, 'refunded')`) once the refund is confirmed; `'period_end'` sets `cancel_at_period_end`.
- Partner commission is cancelled when the original becomes fully refunded (existing helper).
- The route requires the platform permission it already requires, validates the body, and returns `{ success, refund }` or `{ error, code }` (`REFUND_EXCEEDS_PAYMENT`, `NOT_REFUNDABLE`, `GATEWAY_REFUSED`).
- Razorpay `refund.processed` / `refund.failed` on the platform webhook settle a pending refund row by gateway refund id; they never activate a plan.

Tests: full refund with `endPlan: 'now'` → gateway called once with the right payment id and paise, refund row completed, original `refunded`, plan on free, commission cancelled; partial refund → original stays `completed`, second partial completes it; refund above the remaining amount refused; gateway refusal → refund row `failed`, plan unchanged; timeout → row `pending`, then `refund.processed` webhook completes it and applies `endPlan`; repeat click with the same request does not double refund (idempotency key); refund of a coupon-only (₹0) upgrade is `NOT_REFUNDABLE`.

### Task 6: GST mode, tax line and invoice number (SUB-13)

**Files:** create `lib/platform-tax.ts`, `database/migrations/480_subscription_tax_and_refunds.sql`; modify checkout pricing and completion, `app/api/admin/settings/…` (a platform billing-tax settings route beside the existing settings routes) and its screen, billing history route; create the receipt route; tests in the same DB file and `tests/lib/platform-tax.test.ts`.

**Interfaces:**

```ts
export type GstMode = 'none' | 'inclusive' | 'exclusive';
export type TaxSettings = { mode: GstMode; ratePercent: number; sellerGstin: string | null; sellerLegalName: string | null; sellerAddress: string | null; invoicePrefix: string };
export function computeTax(netOfDiscountAndCredit: number, s: TaxSettings): { taxable: number; tax: number; payable: number };
export async function loadTaxSettings(): Promise<TaxSettings>;
export async function nextInvoiceNumber(client: PoolClient, settings: TaxSettings): Promise<string>;
```

- Migration 480 adds to `platform_settings`: `subscription_gst_mode` (default `none`, CHECK three values), `subscription_gst_rate` (default 18), seller GSTIN, legal name, address, `subscription_invoice_prefix` (default `KH`); creates `subscription_invoice_counters (financial_year TEXT PRIMARY KEY, last_number INT NOT NULL)`; adds a unique index on `billing_transactions (invoice_number) WHERE invoice_number IS NOT NULL`.
- `computeTax`: `none` → taxable = amount, tax 0, payable = amount; `inclusive` → payable = amount, taxable = amount ÷ (1 + rate), tax = payable − taxable; `exclusive` → taxable = amount, tax = amount × rate, payable = taxable + tax. Rounded to paise; taxable + tax always equals payable.
- Pricing applies tax last (after coupon and credit). The pending row stores `tax_amount` and the payable `total_amount`, plus `metadata.tax = { mode, rate, taxable }` as they were when the link was created; completion uses the stored values, never the current setting.
- On completion with mode other than `none`, inside the completion transaction, the row gets `invoice_number` = `{prefix}/{financial year, e.g. 2026-27}/{6-digit sequence}` from the counter row (`INSERT … ON CONFLICT … DO UPDATE … RETURNING`), financial year by the Indian April–March year of `CURRENT_DATE`.
- Refund rows carry negative-free amounts and the original's tax split pro rata in `metadata.tax`; no credit-note numbering in this plan.
- Receipt route: owner or platform admin, session business only; renders an HTML page with seller details, buyer business name and GSTIN, plan, period, taxable value, tax, total, invoice number when present, and "Receipt" instead of "Tax invoice" when mode was `none`.
- Admin settings route: platform permission for settings; validates mode, rate 0–28, GSTIN format when present; switching to a mode other than `none` requires seller GSTIN and legal name.

Tests: `computeTax` table for the three modes at ₹299, ₹1 and ₹4,499 (sum identity); default settings → a checkout charges exactly the plan price and stores tax 0, no invoice number; exclusive 18 % on ₹299 → payable 352.82, tax 53.82, invoice number assigned on completion and unique under two simultaneous completions; mode switched after link creation → stored amounts win and the webhook amount check uses them; receipt shows the stored split; a second business cannot open another's receipt.

### Task 7: Screens show renewal, grace, credit, tax, receipts and refunds (SUB-07, SUB-11, SUB-13)

**Files:** `components/settings/ModuleSubscriptionCard.tsx`, `components/subscription/SubscriptionChangePlanModal.tsx`, `components/settings/SubscriptionTab.tsx`, `components/admin/BusinessAdminPanel.tsx`, `app/api/subscriptions/checkout/preview/route.ts` (new, read-only pricing breakdown); tests `tests/lib/subscription/renewal-view.test.ts` for the pure view helpers in a new `lib/subscription/renewal-view.ts`.

**Interfaces:**
- `GET /api/subscriptions/checkout/preview?plan_id=&billing_cycle=&coupon_code=` (owner only) returns the same breakdown checkout would charge: `{ base, discount, credit, taxable, tax, payable, period: { kind, start, end } }`. It writes nothing.
- `renewalView(sub)` in `lib/subscription/renewal-view.ts` returns `{ state: 'active' | 'ending_soon' | 'in_grace' | 'cancelled' | 'free' | 'trial', headline, detail, primaryAction: 'renew' | 'undo_cancel' | 'choose_plan' | null }` from the fields Task 4 added.
- Card: shows "Ends on {date}" (never "Renewal"), a **Renew** button when `can_renew` (starts checkout for the current plan and cycle), "Your plan ended on {date}. You have full access until {grace date}." in grace, and **Keep my plan** when cancelled but not ended.
- Change-plan modal: the current plan is selectable as "Renew"; before confirming it shows the preview breakdown, including "Credit for unused time on your current plan: −₹X" and "Your new period: {start} to {end}"; a downgrade keeps its existing wording plus "You will be asked to pay for {plan} when your current period ends."
- Billing history: a "Receipt" link per completed payment; refund rows shown as "Refund".
- Admin panel: a **Refund** control on completed payments with amount (default full remaining), "End the plan now" / "Let it run to the end of the period", notes, and a confirmation that names the amount and the gateway.

Tests: `renewalView` table for each state; preview route returns the same numbers as a checkout created immediately after (DB test); no browser test in this plan — list the manual checks at the end.

---

## After the last task

- Migration 480 needs owner approval before staging.
- Manual staging checks: renew early and confirm the end date moves out; upgrade and confirm the credit line; open a receipt; in Razorpay test mode refund a test payment fully with "End the plan now".
- Owner and CA: choose the GST mode, rate and seller details in Admin → Settings before switching away from `none`; credit-note numbering for refunds is not built.
- Append the project log entry and update the audit report's status table.

## Owner decisions inside this plan

| Task | Decision taken here | Alternative |
| --- | --- | --- |
| 1 | Renewing the same plan before it ends adds the new period after the current one. Changing plan starts a new period today. | Always start today. |
| 2 | An upgrade is credited with the unused share of the last payment for the current plan; the charge never goes below ₹1; no cash is returned. | No credit, stated clearly. |
| 3 | Seven days of grace start the day after the period ends, without waiting for the nightly job. | Keep the nightly stamp as the start. |
| 5 | A refund is admin-only; the admin chooses whether the plan ends now or at period end; partial refunds are allowed and do not change the plan by themselves. | Full refunds only, plan always ends. |
| 6 | GST is off by default (charges unchanged). When switched on, tax is computed after coupon and credit, and invoice numbers run per Indian financial year. | Switch on now as exclusive 18 %. |
