# Billing screens and wording (fifth fix plan after the audit)

Source: `docs/qa/subscription-billing-audit-2026-11-26.md`, findings SUB-10, SUB-29 (rest), SUB-30, SUB-32, SUB-33, SUB-34, SUB-40, SUB-42, SUB-43.

**Goal:** what a customer reads about plans and payments is true, and every plan a screen offers can be bought.

**Rule for every task:** the plan catalogue in the database is the truth. Where text and catalogue disagree, the text changes, never the catalogue or a price. No charge changes. A plan priced at Rs 1 must still be listed and buyable.

## Task A: the app's plan and payment screens (web)

1. **Success screen from the server (SUB-10).** `components/settings/SubscriptionTab.tsx` shows "Payment received" from the URL alone. Add `GET /api/subscriptions/checkout/status?tx=<id>` (business from the session; a payment of another business is 404) returning `pending | completed | failed | expired`, the plan name and, for a shortened period, the days bought. The return URL carries the payment id. The screen shows "Checking your payment" and asks the server every few seconds for up to two minutes; it says the plan is active only when the server says `completed`; on `failed` it says no plan was changed and whether money was taken is shown by the bank; on timeout it says the payment is still being confirmed, the plan will switch on by itself, and nothing needs to be paid again. Handle the Easebuzz `payment=pending` and `addon=*` returns the same way. Show plan names, never plan ids.
2. **Only plans on sale are offered (SUB-30).** One server function decides which plans a business may be offered for a product: on sale (public and active), plus the plan it is on now (shown as current, not selectable unless renewable). The module card, the change-plan modal, the upgrade picker and `GET /api/subscriptions/plans` (the phone reads it) all use it. `POST /api/subscriptions/upgrade` and checkout refuse a plan that is not on sale with a plain message.
3. **Labels and prompts (SUB-29).** Upgrade, downgrade and current labels come from `lib/subscription/plan-tier.ts` for every product, including Connect and HR. An upgrade prompt for a feature names the cheapest on-sale plan that has the feature and costs more than Rs 0 when the current plan is free; never a hidden or free plan.
4. **Small states (SUB-43).** The banner says "Your plan ended" in grace, not "Trial ends"; the card shows the price for the cycle the customer is on; no raw plan id anywhere.
5. **Who sees billing (SUB-40).** Billing history, receipts and plan actions follow the same permission the plan-change routes already require; staff without it see the current plan name only and no buttons that would fail.
6. **Debug routes (SUB-42).** `/api/subscriptions/debug` and `/api/subscriptions/addons/debug` require a platform admin as well as a non-production environment.

Tests: database tests in `tests/db/billing-screens.db.test.ts` for the status route (own, other business, each state), the plan-offer function (hidden, Classic, trial, current plan, Rs 1 plan), refusal of a plan not on sale, the permission rule and the debug routes; unit tests for any pure helper.

## Task B: marketing and help text

Check every claim about plans, prices, limits and what Free includes against the seeded catalogue (migrations up to 481; `database/schema.sql`) and correct the text (SUB-32, SUB-33): `components/marketing/landing/*`, `app/signup/page.tsx`, `app/(app)/upgrade/page.tsx` (retired plans and prices: read plans from the server instead of a hardcoded list), `knowledge/prospect/pricing-and-plans.md`, `marketing/khatario-features.html`, the outage fallback price table (add HR plans, or state it is partial), and any other hardcoded price found by search. Deliver a table in the report: claim, file, what the catalogue says, new text. Add a unit test that fails when a hardcoded fallback price differs from the seed.

## Task C: the phone app can reach checkout (SUB-34)

`phone/lib/screens/settings/plan_picker_screen.dart` ends every paid choice in "write to support". Open the web subscription page in the browser with `url_launcher` (already a dependency), using the app's configured server address, with a plain sentence saying payment happens on the website and the app updates by itself afterwards; refresh the plan when the app returns to the foreground. Flutter is not installed in this environment: the change must be small, follow an existing `url_launcher` call in the phone code, and be reported as not compiled.

## Finish

One review of the whole change, one round of fixes, suites run, project log, audit status table, QA index and roadmap updated.
