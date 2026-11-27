# Remaining billing findings (sixth fix plan after the audit)

Source: `docs/qa/subscription-billing-audit-2026-11-26.md` (SUB-17, 19, 20, 24, 25, 35, 38, 39, 45) and the open items recorded in `docs/project.log.md` for plans 1 to 5.

**Rules for every task:** a plan priced at Rs 1 still works end to end; with default settings no charge changes; business always from the session; no customer data is deleted; dates in SQL; migrations written, never applied outside the local test database.

**Not in this plan (owner decisions or production access):** checking `platform_limits` on production (rest of SUB-14); turning on the sales assistant's `HR_LAUNCHED` flag (`lib/rag/product-availability.ts`), a launch decision; plan versioning and grandfathering (SUB-35 asks for it; this plan adds the warning and audit trail only); moving add-on prices from code into the catalogue.

## Task 1: coupons (SUB-17)
- Redemption locks the coupon row `FOR UPDATE` inside the payment-completion transaction and re-checks `max_redemptions`, `max_per_business`, validity dates and `min_plan_id`; the checks also run when the checkout is created. A coupon that has run out between checkout and payment does not fail a paid payment: the payment completes at the price paid, the redemption is recorded as over the limit, and the nightly report counts it.
- `min_plan_id` is enforced by tier (`lib/subscription/plan-tier.ts`), never price.
- The recorded discount is the real discount on the chosen cycle.
- A coupon that would make the amount zero gives at most one month free on a longer cycle (the discount on a yearly or longer cycle is capped at the monthly price), so a 100% coupon cannot give three years free. Partial-percentage and flat coupons apply to the chosen cycle as today.
- A null transaction id can no longer defeat the unique redemption key.
- Also: find and fix the cause of the intermittent failure of "cancel then pay the same plan" in `tests/db/renewal-refund-gst.db.test.ts` (failed once in five full runs).

## Task 2: limits (SUB-25, SUB-39, SUB-38, HR keys)
- One helper takes a per-(business, limit) advisory lock, counts and inserts in one transaction. Apply it to every non-atomic limited create: employees, branches, credit notes, estimates, expenses, suppliers, HR limits, WhatsApp sends, AI replies.
- `checkLimit` fails closed when the count query throws: the request is refused with "Please try again in a moment", and the error is logged.
- A registry limit of 0 means 0; the legacy JSON on the plan row is not consulted (SUB-39).
- Enforce `max_designations`, `max_departments`, `max_commissions_per_month`, `max_performance_reviews_per_month` where those records are created.
- Connect entitlement cache (SUB-38): at most 30 seconds, and cleared in-process on any plan change; workers re-read within that time.

## Task 3: automation after a downgrade (rest of SUB-20)
Bot auto-replies, flows, follow-ups and reminders that send WhatsApp messages check the Connect plan and the daily WhatsApp cap before sending, the same way campaigns now do. A skipped send is recorded with the reason; nothing is deleted; it resumes when the plan allows.

## Task 4: over-limit after a downgrade (SUB-24) and Free web access (SUB-19)
- When a business has more users than its plan's seats (after a downgrade or lapse), the extra users cannot sign in or use the app until the owner chooses who keeps access or upgrades. Default choice until the owner acts: the owner and the longest-standing users keep access. Nothing is deleted; an upgrade restores access at once. The owner sees which users are paused and can swap them.
- Branches above the plan's branch limit become read-only (records can be viewed, nothing new is recorded in them) on the same rule.
- Free plan "phone app only": the browser gate fails closed (if the plan check errors, show the gate with a retry, not the app), and the check also runs on the server when web pages render, so turning off JavaScript does not bypass it. The phone app's API calls are not affected.

## Task 5: admin and housekeeping
- Plan edits (SUB-35): the admin screen shows how many businesses are on the plan before saving and asks for confirmation; every change to a plan's price, features or limits is written to the admin audit log with before and after values. Make migration 360 safe to run twice if it is not.
- Admin subscription editor computes dates in SQL.
- Archived receipts: a platform admin can open the receipt of a payment of a deleted business.
- Flagged refunds get a "mark reviewed" action (who and when recorded).
- Migration 482: the HR Lite plan description stops saying "Included with every Billing plan".
- SUB-45: update `docs/HOW_TO_MODIFY_SUBSCRIPTION_PLANS.md` to the current tables; remove `prisma/schema.prisma` if nothing uses it; remove `FIX_ADDON_START_DATE.sql` (it holds a real business id).
- Customer screens stop sending `business_id` (upgrade, cancel, coupon validate); the server already ignores it.
- The recurring-invoice job checks the plan with the same usability rule as everything else, so cron order does not matter.

## Finish
One review of the whole change, one round of fixes, suites run, docs updated, commit and push.
