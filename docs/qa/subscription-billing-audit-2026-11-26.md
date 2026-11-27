# Subscription and billing audit, 2026-11-26

Audit only. No application code, migration, plan, price or customer data was changed. Commit audited: `49cb967`.

**Verdict: Not Production Ready** for commercial launch of paid plans. Reasons are in section F.

## Fix status (updated 2026-11-26, same day)

The first fix plan, `docs/superpowers/plans/2026-11-26-billing-money-path-fixes.md`, is built on branch `claude/gifted-gates-jx4rbn` and not merged or deployed. The findings below are kept as written at audit time.

| Finding | State on the branch |
| --- | --- |
| SUB-01, 02, 03, 04, 05, 16, 26, 27, 28, 31 | Fixed, with tests in `tests/db/billing-money-path.db.test.ts` (83 tests on local `kh_phase2_test`). Not verified on staging or against a real gateway. |
| SUB-29 | Partly fixed: upgrade and downgrade are now judged by an explicit tier rank, not `sort_order` alone. The pickers still list plans that are not on sale (SUB-30). |
| SUB-08, 09, 12, 18, 21, 22, 23 | Fixed by the second plan, `docs/superpowers/plans/2026-11-27-plan-enforcement-gaps.md`, with tests in `tests/db/plan-enforcement.db.test.ts` (174 tests on local `kh_phase2_test`). Not verified on staging. Migration 478 written, not applied. |
| SUB-20 | Partly fixed: recurring invoices and campaigns now check the plan when they run. Bot auto-replies, flows, follow-ups and reminders still check neither the Connect plan nor the daily WhatsApp cap. |
| SUB-23 | Employee and attendance limits now cover every write path, and monthly counts use the entry time. `max_designations`, `max_departments`, `max_commissions_per_month` and `max_performance_reviews_per_month` still have no enforcing call site. |
| SUB-15, SUB-36, SUB-41 | Fixed by the third plan, `docs/superpowers/plans/2026-11-27-payment-record-safety.md`: migration 479 (written, not applied) adds a unique rule on completed gateway payment ids, a billing-cycle check and a payment archive; deleting a business archives its payments first; each payment records its period; a fresh database now applies 498 of 503 migrations (005, 008, 049, 111, 125 still fail for older reasons). Tests in `tests/db/payment-record-safety.db.test.ts` (27 on local `kh_phase2_test`). |
| SUB-14 | The production setup script now copies `platform_limits`, which only helps a future setup. The production check (`SELECT count(*) FROM platform_limits;` must not be 0) is still owed. |
| All other findings | Open. |

Found by the whole-change review and fixed in the same branch: the Razorpay add-on path trusted webhook notes for what was bought and did not check the amount; an Easebuzz failure could redirect the browser to the success page; an expired link sent a "payment failed" message.

Known and left open by decision: coupon limits are not re-checked when a payment is redeemed; the month arithmetic in `computeSubscriptionPeriodEnd` overflows at month end (SUB-37); a customer in the 7-day "awaiting payment" grace after a downgrade has no Renew button (SUB-11); Razorpay payments completed before this change are invisible to the new nightly report.

## How to read the evidence

Each finding carries one of these labels.

| Label | Meaning |
| --- | --- |
| **Reproduced** | The real library code was run against the local disposable database `kh_phase2_test` (PostgreSQL 16, port 5433, schema plus migrations, no real customer data), or as a pure function. Probe scripts: `probes/pure.ts`, `probes/db.ts`, `probes/db2.ts` in the session scratchpad (not in the repo). Gateway calls were not made; Razorpay webhooks were simulated with correctly signed bodies. |
| **Code-read** | Confirmed by reading the cited lines. Not executed. |
| **Not verified** | Suspected; needs a check before acting. |

Limits of this audit:

- Staging and production were not inspected. The plan catalogue below is what the migrations produce; an admin may have edited the live one.
- No real payment was made. Razorpay behaviour (a failed attempt followed by a successful one on the same payment link, both carrying the link's notes) is how Payment Links are documented to work, but it was simulated here, not observed in Razorpay test mode.
- Playwright specs were not run.
- HTTP routes were not called through a running server; the route handlers were read and the library functions they call were executed.

---

## A. Executive summary

The tenant-facing subscription API is well guarded: the business always comes from the signed session, plan changes are owner-only, the amount is always computed on the server, gateway signatures are checked, and a browser redirect never activates a plan. No cross-tenant access to another business's subscription or payment was found.

The problems are in the money path and the lifecycle around it:

1. **A paid plan can be obtained without paying** (SUB-01). Two ordinary owner API calls and a one-month wait give Connect (₹1,499/month) or HR Pro (₹499/month) free for about five weeks, repeatably. Reproduced.
2. **A customer can pay and get nothing** (SUB-02, SUB-03). With Razorpay, one failed attempt followed by a successful retry on the same link leaves the plan inactive, and the gateway's retry is swallowed as a duplicate. Any error after the payment row is marked completed has the same result. There is no reconciliation job. Reproduced.
3. **Revenue leaks**: the "monthly" Khatario AI add-on never expires (SUB-04); a scheduled downgrade to a cheaper paid plan is applied for a month with no charge (SUB-05); free-month coupons are redeemed and ignored (SUB-16).
4. **Refunds do not work** (SUB-06). The admin refund call always fails on a state rule, and nothing calls the gateway or changes entitlements.
5. **There is no renewal**: no auto-charge, no reminder before a paid period ends, no "renew" button, and paying early throws away the remaining days (SUB-07, SUB-11).
6. **Several limits and features are not enforced on the server**: console seats (SUB-08), WhatsApp daily cap on one route (SUB-09), e-Way bill quota, Free "phone only", and automation that keeps running after a downgrade.
7. **GST on Khatario's own subscription fees is not handled at all**: no tax line, no invoice number, no tax invoice (SUB-13).
8. **Tests do not cover the money path.** 504 tests passed here, but none exercises checkout, coupons, renewal, downgrade, cancel, grace, refund or the subscription cron end to end.

Counts: 3 Critical, 12 High, 21 Medium, 9 Low.

---

## B. Architecture map

Payment gateways actually implemented for Khatario's own billing: **Razorpay Payment Links** and **Easebuzz**, switchable in Admin → Settings → Payments (`lib/platform-payment-settings.ts:100-145`). Both are one-off payments. There is no stored mandate and no gateway subscription object.

```
Registration
  app/api/signup → lib/businesses/provision-business.ts:228-259
  → seedInitialModuleSubscription: billing → plan 'trial' (30 days), hr → 'hr_trial', connect → 'connect_free'
  → billing signups also get bundled HR (ensureComplimentaryHrForBilling)

Record of truth
  business_module_subscriptions, PK (business_id, module_key); one row per product (billing / hr / connect)
  plan catalogue: subscription_plans, subscription_plan_features, subscription_plan_limits, platform_limits
  (business_subscriptions is legacy and unused)

Checkout
  POST /api/subscriptions/checkout (owner only)
  → resolveCheckoutPricing (plan price for cycle − coupon, server side)
  → final ₹0: applyInstantPlanUpgradeWithCoupon (no gateway)
  → else: billing_transactions row 'pending' → hosted payment link (Razorpay) or access key (Easebuzz)
  POST /api/subscriptions/upgrade: instant, only for plans whose every cycle is ₹0

Payment verification
  Razorpay: POST /api/webhooks/platform-billing/razorpay → processPlatformRazorpayWebhook
            HMAC-SHA256 of raw body; business and transaction id from the link's notes
  Easebuzz: POST /api/payments/return/easebuzz (browser) and /api/webhooks/platform-billing/easebuzz
            SHA-512 response hash; business, plan and amount from the stored pending row
  Idempotency: platform_billing_webhook_events UNIQUE (provider, idempotency_key)

Activation
  completeSubscriptionCheckoutPayment → billing tx 'completed' → applyModuleSubscriptionPlanChange
  (start = today, end = today + cycle, + unused trial days) → coupon redemption → partner commission

Entitlement
  authorize() path gate + assertFeatureAccess / withBusinessApi (features, per operational module)
  checkLimit / checkLimitInTransaction (limits, counted live from business tables)
  getEntitlementPlanId: expired trial → free plan; isModuleSubscriptionOperational: past end_date with no grace → blocked

Lifecycle (daily cron, 03:30, VPS crontab → /api/cron/check-subscriptions, Bearer CRON_SECRET)
  processExpiredModuleSubscriptions:
    extended trial ended → free | cancel_at_period_end and ended → free
    scheduled_plan_id and ended → switch plan, new end_date +1 month
    active past end_date → grace_period_end = end_date + 7 | grace ended → free
  sendPendingNotifications: trial 7/3/1 days, trial ended, grace ends in 3 days, usage 80/90/100 %

Renewal: none automatic. The customer must buy again.
Cancellation: POST /api/subscriptions/cancel sets cancel_at_period_end.
Refund: admin API marks a row (does not work, SUB-06).
```

Frontend: `/pricing` and the landing page read the catalogue from the database (`lib/subscription/pricing-catalog.ts`); in-app pickers read `/api/subscriptions/plans`; the subscription page is `components/settings/SubscriptionTab.tsx` with `ModuleSubscriptionCard.tsx`; the phone app has a native Plan & billing screen that cannot take payment.

---

## C. Plan and feature matrix (as the migrations seed it)

Verified on the local database after `schema.sql` plus all migrations. Currency INR. "Not offered" means the cycle price is 0 on a paid plan.

| Plan id | Shown as | Product | Monthly | Yearly | 3-year | Public | Sort | Bundled HR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `free` | Free | billing | 0 | 0 | 0 | yes | 1 | none |
| `billing_starter` | Starter | billing | 299 | 2,699 | 5,999 | yes | 2 | HR Lite |
| `billing_growth` | Growth | billing | 499 | 4,499 | 9,999 | yes | 3 | HR Starter |
| `billing_business` | Business | billing | 799 | 7,199 | 15,999 | yes | 4 | HR Pro |
| `trial` | Trial (30 days + one 7-day extension) | billing | 0 | 0 | 0 | no | 5 | HR Pro |
| `growth` | Growth Classic | billing | 399 | 3,588 | 7,999 | no | 30 | HR Lite |
| `business` | Business Classic | billing | 999 | 9,588 | 21,999 | no | 31 | HR Lite |
| `hr_staff_lite` | HR Lite | hr | 0 | 0 | 0 | yes | 9 | |
| `hr_starter` | HR Starter | hr | 199 | 1,990 | not offered | yes | 10 | |
| `hr_pro` | HR Pro | hr | 499 | 4,990 | not offered | yes | 11 | |
| `hr_trial` | HR Trial | hr | 0 | 0 | 0 | no | 12 | |
| `hr_free` | HR Free | hr | 0 | 0 | 0 | no | 13 | |
| `connect` | Connect | connect | 1,499 | 14,388 | 34,999 | yes | 20 | |
| `connect_free` | Connect (not active) | connect | 0 | 0 | 0 | no | 21 | |

Implied discounts are arithmetically consistent: billing yearly about 25 %, 3-year about 44 %; HR yearly 16.7 %; Connect yearly 20 %, 3-year 35 %. The UI computes them from the prices (`lib/subscription/pricing-view.ts:125-137`). Business Classic costs more than the new Business for the same 69 features and a weaker HR bundle (may be intended).

Add-on, priced in code and not in the catalogue: Khatario AI top-up ₹299 "monthly", 3,000 replies a month (`lib/ai-agent/billing-constants.ts`).

**Features (count of enabled keys):** free 18, Starter 44, Growth 57, Business 69, trial 69, Growth Classic 56, Business Classic 69, HR Lite 7, HR Starter 12, HR Pro 16, HR Trial 16, HR Free 4, Connect 8, Connect free 5. The headline steps:

- Free: invoices, estimates, purchases, basic and GST reports, backup, WhatsApp link. No `web_access` (phone app only).
- Starter adds: website access, multi-user, POS mode, barcodes, credit and debit notes, delivery challans, purchase orders, suppliers and Supplier Hub, expenses, e-Way bill, email, payment gateway, WhatsApp auto reminders.
- Growth adds: ledger and accounting, advanced reports, recurring invoices, sales orders, additional businesses, deleted-records restore.
- Business adds: branches, warehouses, online store, multi-currency, e-Invoice flag, API flag, report builder, analytics, work orders, multi-device login.

**Limits (−1 = unlimited):**

| Limit | Free | Starter | Growth | Business | Trial |
| --- | --- | --- | --- | --- | --- |
| Console users | 1 | 3 | 5 | 10 | 10 |
| Branches | 1 | 1 | 1 | 3 | 3 |
| WhatsApp messages per day | 20 | 200 | 300 | 500 | 200 |
| Emails per day | 10 | 100 | 200 | 500 | 500 |
| e-Way bills per month | 0 | 10 | 25 | −1 | −1 |
| Credit notes, sales orders, purchase orders per month | 0 | −1 | −1 | −1 | −1 |
| Invoices, customers, items, estimates, purchases, suppliers, expenses | −1 | −1 | −1 | −1 | −1 |

| Limit | HR Lite | HR Starter | HR Pro / Trial | HR Free |
| --- | --- | --- | --- | --- |
| Employees | 30 | 50 | 200 | 0 |
| Attendance records per month | 1,000 | 1,600 | −1 | no row |
| Payroll records per month | 60 | 100 | −1 | no row |
| Console users | 1 | 5 | 15 | 1 |

Connect: 5 agents, 1,000 WhatsApp messages a day, 500 AI replies a month. Connect free: 1 / 20 / 0.

Where plan data is defined: the database is the single source for prices, features and limits. Exceptions that can drift are listed in SUB-33.

---

## D. Findings register

### Critical

**SUB-01. A paid plan can be activated without payment.** Reproduced.
- Where: `app/api/subscriptions/upgrade/route.ts:44-53,63-66,84-120`; `lib/subscription/module-plan-lifecycle.ts:29-49`; `lib/subscription/lifecycle.ts:367-403`.
- Problem: `/upgrade` applies any active plan whose prices are all ₹0. It blocks only the id `trial` and does not check `is_public`, so the hidden plans `connect_free` and `hr_free` are accepted and get an `end_date` one month ahead. `/downgrade` decides "lower tier" by `sort_order` alone, and the paid plans `connect` (20) and `hr_pro` (11) sort below `connect_free` (21) and `hr_free` (13). The cron then applies the scheduled plan with a fresh one-month period and never asks for money.
- Steps: as owner, (1) `POST /api/subscriptions/upgrade {"plan_id":"connect_free"}`; (2) `POST /api/subscriptions/downgrade {"target_plan_id":"connect","confirmed":true}`; (3) wait for the end date and the nightly cron.
- Result on the local database: `connect:connect`, features `integration_whatsapp_bot`, `integration_whatsapp_manual`, `whatsapp_auto_reminders` all true, completed payments 0. Same with `hr_free` → `hr_pro` (`hr_leaves`, `hr_employee_portal`, `hr_advanced` true). After the free month the row gets 7 more days of grace, drops to free, and the steps can be repeated.
- The web UI itself labels `connect_free → connect` as "Downgrade" (`lib/subscription/trial-plan.ts:58`), so an honest customer who tries to buy Connect from the subscription card is routed into this path.
- Impact: Connect and HR Pro free for about 37 of every 67 days; Connect also consumes paid WhatsApp API and AI usage.
- Fix: in `/upgrade`, allow only the module's designated free plan and require `planOpenToBusiness`; in the downgrade path compare price (or an explicit tier rank per product), reject any target whose price is higher than the current plan's, and when the cron applies a scheduled plan that has a price, move to the free plan (or grace) instead of granting a period.

**SUB-02. Razorpay: a failed attempt followed by a successful payment leaves the customer unactivated.** Reproduced with signed webhooks.
- Where: `lib/platform-billing.ts:576-598` (failed event marks the checkout row `failed`), `lib/platform-subscription-checkout.ts:462-469` (success then throws "already failed"), `lib/platform-billing.ts:502-512` (the event is recorded before processing, so the gateway's retry returns `duplicate`), `lib/platform-billing-transaction-state.ts:28-67`. `tests/lib/billing-transaction-state.test.ts` asserts "blocks failed → completed".
- Steps: create a checkout; deliver `payment.failed` for the link; deliver `payment.captured`; redeliver it.
- Result: transaction stays `failed`, no subscription row, second delivery throws (HTTP 500), third returns `{ok:true,duplicate:true}`; the event row is left at `received`.
- Impact: the customer is charged, sees a success screen (SUB-10), receives a "payment failed" email and WhatsApp from the first attempt, and has no plan. Failed first UPI attempts are common. Support has no tool to finish the activation other than editing the subscription by hand.
- Fix: treat a failed attempt as an attempt, not as the end of the checkout (keep the row `pending` until the link is paid, cancelled or expired), and allow `failed → completed` when a verified success arrives.

**SUB-03. No recovery when activation fails after the payment is recorded.** Reproduced (failure forced through an unknown plan id).
- Where: `lib/platform-subscription-checkout.ts:473-513` (status update, plan change, coupon and commission are separate statements with no transaction); `lib/platform-billing.ts:502-512`.
- Result: transaction `completed`, no subscription change, redelivery returns `duplicate`.
- Also: there is no job that compares completed payments with subscription state, no job that asks the gateway about old `pending` rows, and the Easebuzz path has the same shape (`lib/platform-billing.ts:675-679`).
- Fix: do the status change and the plan change in one database transaction with the row locked; mark the webhook event processed only at the end and reprocess events left at `received`; add a daily reconciliation.

### High

**SUB-04. The Khatario AI "monthly" add-on never expires.** Reproduced.
- `lib/platform-addon-checkout.ts:58-97` activates with `end_date = NULL`; no code ends a `whatsapp_addons` row; the purchase route refuses a second purchase while active (`app/api/subscriptions/addons/[type]/purchase/route.ts:78-87`).
- Result after one ₹299 payment: `status active, end_date null`. `hasKhatarioAiTopUp` (`lib/ai-agent/billing.ts:16-25`) then adds 3,000 replies every month indefinitely, and does not require Connect to still be active.
- Fix: give the add-on a one-month end date extended by each payment, and expire it in the cron.

**SUB-05. A scheduled downgrade to a cheaper paid plan is granted for a month with no charge.** Reproduced.
- `lib/subscription/lifecycle.ts:381-392`. Business ₹799 → Starter: after the cron, `billing_starter`, new end date +1 month, payments recorded 0; then 7 days of grace.
- The downgrade dialog does not mention payment (`components/subscription/SubscriptionChangePlanModal.tsx:547-549`).
- Fix: at period end move to grace on the lower plan (or to free) and ask for payment.

**SUB-06. Refunds do not work.** Reproduced.
- `app/api/admin/businesses/[id]/billing/[txId]/refund/route.ts:28-40` calls `updateBillingTransactionStatus(…,'refunded')`, and `assertBillingTransactionTransition` rejects every move out of `completed` (`lib/platform-billing-transaction-state.ts:56-67`). Result: "Cannot transition billing transaction from completed to refunded".
- Beyond that: no gateway refund call for platform payments, no refund amount (so no partial refund), no change to the subscription, no handling of gateway refund webhooks (a partial `refund.processed` is read as a success event and throws, probe P2), no admin screen calls the route, and the partner-commission cancellation in `lib/platform-billing.ts:237-247` can never run.
- The published policy promises a full refund within 7 days of a first payment (`lib/marketing/legal/refund.ts:12`).
- Fix: decide the refund rule for entitlements, then add `completed → refunded` with an amount, a gateway call, and an explicit "end plan now / keep until period end" choice.

**SUB-07. Buying mid-period discards the time already paid for, and ₹0 "upgrades" cancel a paid plan instantly.** Reproduced.
- `lib/subscription/apply-module-plan-change.ts:47-78` always sets start = today and end = today + cycle. A yearly Growth with 335 days left became a one-month Business ending 30 days later. Re-buying the same plan early has the same effect.
- A yearly Business ending 2027-11-26 became `free` ending 2026-12-26 through `/upgrade {"plan_id":"free"}`. The phone picker offers this with no confirmation (`phone/lib/screens/settings/plan_picker_screen.dart:55-59`), and the HR card labels the move to `hr_free` "Upgrade" because of sort order.
- This contradicts the pricing FAQ ("a move to a smaller plan starts when your current paid period ends", `lib/marketing/pricing-page.ts:24`). No screen discloses the loss.
- Fix: extend from the current end date on same-plan renewal, credit unused value on upgrade (or state plainly that there is no credit and block the purchase until the last days), and send every paid → ₹0 move through the scheduled downgrade.

**SUB-08. The console-seat limit can be exceeded.** Code-read.
- `app/api/settings/users/[id]/route.ts:214-217` checks the limit only when a seat moves or a user is reactivated; `:321-324` then writes `role_id` for any user. Attendance-only employees do not count as seats until they have a role (`lib/subscription/seat-counting.ts:22-29`).
- Steps: on Starter (3 seats), create employees without a role, then `PATCH /api/settings/users/{id} {"role_id":…,"password":…}` for each.
- Impact: the main paid limit between Starter, Growth and Business is not enforced.

**SUB-09. `POST /api/invoices/[id]/whatsapp` has no permission, plan or daily-limit check.** Code-read.
- `app/api/invoices/[id]/whatsapp/route.ts:13-69` checks only that the invoice belongs to the session business, then sends a client-supplied message and a client-supplied document URL.
- Impact: any signed-in staff user can send unlimited WhatsApp messages (the 20/200/300/500 per-day caps do not apply) and attach an arbitrary link, on any plan.

**SUB-10. The payment success screen is driven by the URL.** Code-read.
- `components/settings/SubscriptionTab.tsx:141-163,561-568`: `?payment=success&plan=X` shows "Payment received! Welcome to X" and "All premium features are now unlocked" before any server data. There is one refetch and no polling of the transaction. With Razorpay the plan changes only when the webhook arrives. Easebuzz redirects to `payment=pending` and `addon=*`, which the page ignores.
- No entitlement is granted by this (the server is not fooled), but it tells a customer who hit SUB-02 or a delayed webhook that everything worked.

**SUB-11. There is no renewal, and a lapsing customer is locked out before grace starts.** Lockout reproduced; the rest code-read.
- No auto-charge exists, yet `/api/subscriptions/current` returns a hardcoded `true AS auto_renew` (`route.ts:32`) and the UI labels the end date "Renewal".
- No reminder is sent before a paid period ends; the first message is 3 days before grace ends (`lib/subscription/notifications.ts:570-680`).
- The subscription page has no renew action: the current plan is a disabled button (`SubscriptionChangePlanModal.tsx:364-371`).
- From midnight after `end_date` until the 03:30 cron, a paid row is "not operational" and every gated API returns 403 (`lib/subscription/module-operational-check.ts:50-55`). Probe F: operational rows 0 before the cron, restored after. If the cron fails (it logs to a file, with no alert) the lockout lasts until someone notices.
- A ₹0 plan reached through `/upgrade` or a scheduled downgrade also gets an end date, so free-plan businesses hit the same lockout a month later, then a "grace period" (probe N).

**SUB-12. Entitlements can be checked against the wrong business, and trials can be farmed.** Code-read.
- `lib/authorization.ts:165,201` use `users.business_id` (the last business switched to) when the caller passes no business. `POST /api/businesses/switch` updates that column without ending other sessions. A session on a Free business then passes plan gates of a paid business owned by the same user on about 38 call sites (for example `GET /api/ledger`). The data returned is still the session business's own, so this is an entitlement leak, not a data leak.
- `POST /api/businesses` gives every additional business its own 30-day full trial and checks the multi-business feature on the same pointer (`app/api/businesses/route.ts:63-86`). The trial plan includes that feature, so trials chain. The only brake is an in-memory limit of 5 per hour.

**SUB-13. GST on subscription fees is not handled.** Code-read.
- Checkout charges plan price minus coupon (`lib/subscription/checkout-pricing.ts:69-72`). `tax_amount`, `invoice_number` and `invoice_url` exist on `billing_transactions` and are never written. Billing history offers no invoice or receipt. The pricing FAQ says "ask our team before you pay".
- Whether prices include GST is an open owner decision (project log, 2026-11-12). Until it is made the charged amount cannot be called correct, and business customers cannot claim input credit.

**SUB-14. The production setup script copies plan limits without the limit registry.** Code-read (simulated by the schema review).
- `scripts/setup-khatario-production.sh:104-119` copies six catalogue tables and omits `platform_limits`. Limit resolution starts from that table (`lib/subscription/resolve-limit.ts:31-37`), so with it empty every limit resolves to 0, which blocks creation, and the admin limits screen cannot save.
- Production is already live per the project log. **Check on production:** `SELECT count(*) FROM platform_limits;` must not be 0.

**SUB-15. Payment records are weakly protected in the database.** Reproduced for the duplicate reference.
- No unique constraint on `billing_transactions.payment_reference` (two completed rows for different businesses accepted the same gateway payment id).
- `billing_transactions.business_id` is `ON DELETE CASCADE` (`151_subscription_billing_system.sql:11`): deleting a business deletes Khatario's own revenue records.
- A payment row has no link to the subscription period it bought (`subscription_id` points at the legacy table and is never set; `period_start`/`period_end` are never written).
- Status changes are read-check-write without a lock or `AND status = 'pending'` (`lib/platform-billing.ts:211-233`).

### Medium

| ID | Finding | Evidence |
| --- | --- | --- |
| SUB-16 | **Free-month coupons are redeemed and ignored on a paid checkout.** Pricing returns full price with `freeMonths: 3`; after payment the end date is one month out and the coupon is counted as used. `extendModuleSubscriptionForFreeMonths` is called only on the ₹0 path. | Reproduced. `lib/subscription/checkout-pricing.ts:61-63`; `lib/platform-subscription-checkout.ts:488-513` |
| SUB-17 | **Coupon limits are not atomic and partly unenforced.** `max_redemptions` and `max_per_business` are checked when the link is created, counted when it is paid, with no guard on the increment; the unique key is defeated by a null transaction id; `min_plan_id` is never checked; the recorded discount always uses the monthly price. A 100 % coupon on the 3-year cycle gives three years free. | Code-read. `lib/subscription/coupons.ts:109-133,176-203` |
| SUB-18 | **e-Way bill monthly quota (0 / 10 / 25) is shown on the pricing page and enforced nowhere.** | Code-read. No reference to `max_eway_bills_per_month` outside migrations |
| SUB-19 | **Free "phone app only" is enforced in the browser only, and fails open.** | Code-read. `components/layout/WebAccessGate.tsx:24-39`; `businessHasWebAccess` has one caller |
| SUB-20 | **Automation keeps running after a downgrade or lapse.** The recurring-invoice cron does not check `sales_recurring_invoices`; campaigns, bot rules, flows and follow-ups do not check the Connect plan, and campaigns skip the daily WhatsApp cap. | Code-read. `lib/invoices/recurring.ts`; `lib/campaign-processor.ts:72-81` |
| SUB-21 | **Routes on gated features with no plan or permission check:** leave types (create, update, delete), journal-entry templates, Supplier Hub stock requests and dashboards. | Code-read. `app/api/leave-types/route.ts:74-112`; `app/api/journal-entries/templates/route.ts:13-137`; `app/api/stock-requests/**` |
| SUB-22 | **Employee limit bypass:** converting a recruitment candidate and reactivating an employee skip the check. | Code-read. `lib/hr/recruitment/convert-candidate.ts:74-101`; `app/api/employees/[id]/route.ts:465-467` |
| SUB-23 | **HR volume limits are checked on one route each.** Punch, kiosk, face recognition and regularisation insert attendance without a check; four limit keys have no call site; monthly quotas are keyed on client-supplied dates, so backdating evades them. Holidays, shifts and designations have no plan rows, so HR Pro is capped at the defaults 10 / 5 / 10. | Code-read. `lib/subscription/limit-registry.ts:67-69,111-129` |
| SUB-24 | **Nothing reconciles over-limit resources after a downgrade.** Extra users stay signed in and extra branches stay usable; only new creation is blocked. Data is preserved (no deletion on expiry was found). | Code-read. `lib/subscription/lifecycle.ts:296-460` |
| SUB-25 | **Most limit checks are count-then-insert.** Atomic: invoices, purchases, sales and purchase orders, customers, item create, user create. Not atomic: employees, branches, credit notes, estimates, expenses, suppliers, HR limits, WhatsApp sends, AI replies. `checkLimit` allows when the count query throws. | Code-read. `lib/subscription.ts:360-369` |
| SUB-26 | **Abandoned checkouts never expire.** Pending rows stay in billing history forever, and Razorpay links are created with no expiry and with reminders on, so a link made at an old price or with an expired coupon can be paid later. The Razorpay path does not compare the paid amount with the stored amount (Easebuzz does). | Code-read. `lib/payments/providers/razorpay-payment-provider.ts:80-99`; `lib/platform-billing.ts:537-561` vs `:688-694` |
| SUB-27 | **A second event for the same payment returns HTTP 500.** `payment.captured` and `payment_link.paid` have different idempotency keys; the second throws "already completed". State stays correct; in the concurrent probe one succeeded, one threw, coupon counted once. A true simultaneous race was not reproduced. | Reproduced. `lib/platform-billing.ts:496-500` |
| SUB-28 | **Cron updates are unconditional.** Rows are selected, then updated by key only, so a payment landing between the two can be overwritten by "moved to free". Two overlapping runs duplicate events. A second sequential run is clean (reproduced). | Code-read. `lib/subscription/lifecycle.ts:344-457` |
| SUB-29 | **Plan order by `sort_order` is wrong outside the main billing ladder.** Connect cannot be bought from its card (it is treated as a downgrade), `hr_free` shows as an upgrade, and upgrade prompts for HR features name the ₹0 HR Lite. | Reproduced (labels). `lib/subscription/trial-plan.ts:41-60`; `lib/subscription/feature-access-info.ts:41-55` |
| SUB-30 | **Plans that are not on sale are listed in pickers.** The module card and the phone picker show Classic, trial and hidden free plans; choosing a Classic plan ends in "Failed to change plan". | Code-read. `lib/subscription/list-plans.ts:7-37`; `components/settings/ModuleSubscriptionCard.tsx:97-111` |
| SUB-31 | **The "30-day HR trial" started from the product picker is not a trial.** `/upgrade {"plan_id":"hr_trial"}` creates an active row with no trial end date; entitlements resolve to `hr_free`. | Reproduced (entitlement). `lib/subscription/effective-plan.ts:30-37` |
| SUB-32 | **Marketing text that is false for the Free plan:** "HR Lite … with every Billing plan", "Free up to 30 staff", "works on phone and computer", and the Connect signup card ("no platform fee … add-ons"). | Code-read. `components/marketing/landing/LandingFaq.tsx:72`; `LandingSuite.tsx:23-26`; `app/signup/page.tsx:84-93` |
| SUB-33 | **Stale hardcoded plan data.** `/upgrade` page shows Professional ₹299, Business ₹999, Enterprise ₹2,999 (retired). The sales knowledge base says Free has monthly limits and HR is "coming soon". `marketing/khatario-features.html` has Classic prices. The outage fallback price table matches today but has no HR plans. | Code-read. `app/(app)/upgrade/page.tsx:56-64`; `knowledge/prospect/pricing-and-plans.md:13,22` |
| SUB-34 | **The phone app cannot take payment and gives no path to web checkout,** while Free works only in that app. Every upgrade prompt on the phone ends in "write to support". | Code-read. `phone/lib/screens/settings/plan_picker_screen.dart:49-53` |
| SUB-35 | **Admin plan edits take effect on every subscriber at once, with no warning and no audit log;** there is no plan versioning. Migrations 360, 386 and 387 already changed entitlements of existing customers (existing Free businesses lost website access). Migration 360 is unsafe to run twice. | Code-read. `app/api/admin/plans/[planId]/features/route.ts:133-150`; `387_billing_plan_ladder.sql:38,98-99`; `360_plan_catalog_v2.sql:249-260` |
| SUB-36 | **A fresh database cannot be built from the repository.** The base plans come from a hand-run seed file; 16 to 17 migrations fail on a new database (7 on plan seed foreign keys), and the runner continues past failures. | Reproduced by two sub-reviews. `database/seed_subscriptions.sql`; `scripts/run-pending-migrations.js:336-348` |

### Low

| ID | Finding | Evidence |
| --- | --- | --- |
| SUB-37 | Period dates mix UTC and local time: a purchase at 02:00 IST is dated the previous day; a monthly plan bought on 31 January ends 3 March. | Reproduced. `lib/subscription/apply-plan-change.ts:38-49` |
| SUB-38 | Connect entitlement is cached 5 minutes per process; workers are separate processes and are not invalidated. | Code-read. `lib/subscription.ts:589` |
| SUB-39 | A registry limit of 0 is overridden by the legacy JSON on the plan row, although the file header says the JSON is not consulted. | Code-read. `lib/subscription.ts:342-353` |
| SUB-40 | Billing history and plan details are visible to every staff user; buttons are active for staff and fail with a generic message. | Code-read. `app/api/subscriptions/billing-history/route.ts:33` |
| SUB-41 | No CHECK on `business_module_subscriptions.billing_cycle`; several plan-id columns have no foreign key. | Code-read. `256_business_module_subscriptions.sql:11` |
| SUB-42 | Debug routes `/api/subscriptions/debug` and `/addons/debug` depend on `NODE_ENV` alone. | Code-read |
| SUB-43 | Wrong or missing small UI states: grace banner says "Trial ends", the card always shows the monthly price, Easebuzz success shows the raw plan id. | Code-read. `components/subscription/SubscriptionBanner.tsx:108` |
| SUB-44 | Cancelling removes the 7 grace days a non-cancelling customer gets; there is no "undo cancel". | Code-read |
| SUB-45 | Stale documents and files: `docs/HOW_TO_MODIFY_SUBSCRIPTION_PLANS.md` points at the retired table, `prisma/schema.prisma` is unused, `FIX_ADDON_START_DATE.sql` at the repo root carries a real business id. | Code-read |

### Checked and found sound

- Business identity: every subscription route takes the business from the signed session; a client `business_id` is only compared (`lib/auth-helpers.ts:84-112`). Middleware strips client copies of the trusted headers.
- Plan changes are limited to the owner or the primary-admin role of that same business (`lib/security/require-subscription-mutation.ts:11-43`).
- The client cannot set an amount. Prices come from the plan row at checkout time.
- Razorpay signature: HMAC-SHA256 over the raw body, constant-time compare; missing and wrong signatures are rejected (reproduced). The platform cannot be marked ready without a webhook secret.
- Easebuzz: response hash checked; business, plan and amount come from the stored row, not from the callback; amount mismatch is refused.
- One business's payment cannot activate another's: Easebuzz by construction; Razorpay because the transaction is looked up by id **and** business id.
- Paid plans cannot be activated through `/upgrade`, `/api/modules` or `ensure-subscription` directly (SUB-01 is the indirect route).
- Cron endpoint: fails closed without `CRON_SECRET`, constant-time bearer check.
- Trial: 30 days, one 7-day extension, owner only, safe against double grant.
- No code deletes tenant data on expiry or downgrade.

---

## E. Test coverage report

**Executed here** (details and logs in the session scratchpad):

| Run | Result |
| --- | --- |
| 46 non-database Jest suites covering plans, gating, webhooks, pricing view, cron auth | 43 suites passed, 3 failed; 433 tests passed, 2 failed |
| 9 database Jest suites on local `kh_phase2_test` | 9 passed; 71 tests passed |
| `scripts/check-subscription-drift.js` (read-only) | 0 mismatches, on a database with 0 businesses, so it proves little |
| Audit probes (this audit) | 3 scripts, 14 scenarios, results quoted in section D |
| Playwright (11 subscription specs, 79 tests) | **Not executed** |

The three failures are not billing defects: two stale tests (`capability-normalizer`, `more-menu-for-user`) and one suite that cannot start (`capability-snapshot`: a malformed `@jest-environment` line, and `jest-environment-jsdom` is not installed). That last one means the only cache-staleness tests never run.

Quality of what exists: the Razorpay webhook suite mocks the signature check, the database and the activation function, so it proves branching only. The Easebuzz suite uses the real hash. No Jest test imports any `/api/subscriptions/*` route, `coupons.ts`, `checkout-pricing.ts`, `apply-coupon-upgrade.ts`, the downgrade or cancel functions, or the subscription cron route. The e2e helper `e2e/helpers/db.ts` writes straight to whatever database the environment names, with no guard on host or name.

**Coverage against the required scenarios**

| Scenario | Status |
| --- | --- |
| Registration assigns the default trial | Partial (seeding function, not the route) |
| Free plan entitlements | Partial |
| Paid plan only after verified payment | Partial (mocked) |
| Server-side amount | Missing |
| Razorpay signature valid, invalid, missing | Covered at provider level |
| Easebuzz hash | Covered |
| Duplicate webhook | Partial (unique key mocked) |
| Two event types for one payment; concurrent deliveries | Missing |
| Failed attempt then success (SUB-02) | Missing; the existing state test asserts the defect |
| Paid but activation fails | Missing |
| Amount mismatch | Easebuzz only |
| Payment for business A cannot activate B | Partial |
| Abandoned checkout | Missing |
| Renewal, early renewal, mid-cycle upgrade | Missing |
| Downgrade scheduled and applied; cancel; cancel-downgrade | Missing |
| Grace period; cron run twice; cron route auth | Missing (helper tested on another route) |
| Trial expiry | Partial (extended trials only) |
| Trial extension limits | Missing |
| Refund, partial refund | Missing |
| Coupons: maths, limits, concurrency, 100 % | Missing |
| Each plan's features | Partial (spot checks) |
| Limits at N−1, N, N+1 on create routes; concurrent creates | Missing (create-route tests mock the limit to "allowed") |
| Non-owner cannot change plan; unauthenticated access | Missing in Jest (e2e exists, not run) |
| Client `business_id` ignored | Generic wrapper only |
| Business switching; multi-device staleness | Missing |
| Add-on purchase and expiry | Purchase partial, expiry missing |
| Module independence | Partial |
| IST midnight boundaries | Missing |

**Proposed test plan** (database tests on `kh_phase2_test`, gateway stubbed at `fetch`):

1. Checkout and activation: one suite driving `POST /api/subscriptions/checkout` and both webhook routes with real signatures; cases for SUB-01, 02, 03, 16, 26, 27, wrong amount, wrong business.
2. Lifecycle: time-travelled cron suite for trial end, cancel, scheduled downgrade (SUB-05), lapse, grace, grace end, run twice, payment during the run.
3. Period arithmetic: early renewal, upgrade mid-cycle, month ends, 02:00 IST.
4. Coupons: each type on each cycle, limits under parallel requests.
5. Entitlements: table-driven, one row per plan × feature key, calling the real route with a real session; limits at the boundary with parallel creates; the bypass routes in SUB-08, 09, 21, 22.
6. Refund and add-on expiry once the rules are decided.
7. Convert the state test that asserts "blocks failed → completed" when SUB-02 is fixed.

---

## F. Production readiness

**Classification: Not Production Ready.**

Evidence, in order of weight:

1. Paid access without payment is reachable by any owner through documented endpoints (SUB-01), and three more paths give paid service unpaid (SUB-04, SUB-05, SUB-12).
2. A customer who pays can be left without a plan, with no automatic or admin recovery (SUB-02, SUB-03), while the screen says the payment worked (SUB-10).
3. The published refund promise cannot be carried out in the product (SUB-06), and the tax treatment of the fee is undecided and unrecorded (SUB-13).
4. There is no renewal mechanism; lapsing customers are locked out for hours and lose paid days if they pay early (SUB-07, SUB-11).
5. The main paid limit, seats, can be exceeded, and several advertised limits are not enforced (SUB-08, SUB-09, SUB-18, SUB-19).
6. None of the above is covered by a test that would catch a regression.

What is ready: tenant isolation of subscription data, owner-only plan changes, server-side pricing, signature verification, and data preservation on downgrade.

**Suggested order of work** (nothing started; each needs approval):

1. SUB-01, SUB-02, SUB-03, with the tests in plan item 1.
2. SUB-04, SUB-05, SUB-16, SUB-26.
3. Owner decisions: GST inclusive or exclusive and the tax invoice (SUB-13); refund effect on the plan (SUB-06); renewal model, extension from end date and proration (SUB-07, SUB-11).
4. SUB-08, SUB-09, SUB-12, SUB-18 to SUB-23.
5. Check `platform_limits` on production (SUB-14) and add the payment-record constraints (SUB-15).
6. Frontend truthfulness: SUB-10, SUB-29 to SUB-34.
