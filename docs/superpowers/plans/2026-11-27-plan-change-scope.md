# Plan changes for new or existing customers (seventh plan; owner decision 2026-11-27)

Owner's decision: "Admin chooses each time." When an admin saves a change to a plan's features, limits or price, they choose:

- **Apply to everyone now** (today's behaviour): every business on the plan gets the change at once.
- **Only new customers**: businesses already on the plan keep the terms they have (features, limits, price) for as long as they stay on that plan and keep renewing it. A business that changes plan gets the current terms of its new plan. A business that later returns to the plan gets the current terms.

## Design
- Migration 485: `subscription_plan_terms` (id, plan_id, features jsonb, limits jsonb, price_monthly, price_yearly and any other cycle prices the plan has, created_at, created_by, reason) and a nullable `plan_terms_id` on `business_module_subscriptions` (null = the plan's current terms). Idempotent, house style of 479 to 484.
- "Only new customers" save, in one transaction: snapshot the plan's terms as they are before the change (one snapshot per save), pin every business on the plan that is not already pinned to that snapshot, then apply the change to the live plan. Businesses already pinned to an older snapshot stay on it.
- "Apply to everyone now" save: apply the change to the live plan and to the same keys in every snapshot of that plan, so pinned businesses get it too.
- Entitlement reads (feature access, limit resolution, the plan shown on the subscription screens) and the price used when a pinned business renews the same plan come from the snapshot when pinned, otherwise from the live plan. One function decides which terms apply.
- Changing plan (upgrade, downgrade, move to Free, admin assignment) clears the pin in the same statement that sets the new plan. Renewing the same plan keeps it.
- Admin price edit: add it to the admin plan screen with the same choice (there is no price route today). A plan priced at Rs 1 still works.
- The existing affected-businesses count and confirmation stay; the screen says plainly what each choice does and how many businesses keep their old terms. Every save is logged with before and after values and the choice made.
- The admin plan screen shows, per plan, how many businesses are on older terms, and an admin can move them all to the current terms (logged).

## Rules
No charge changes with default use (no save made); business from the session; dates in SQL; migration written, never applied outside the local test database.

## Tests
`tests/db/plan-change-scope.db.test.ts`: both choices for a feature, a limit and a price; pinned business keeps a removed feature and its old limit; renewal of a pinned business charges the old price, through real checkout creation; upgrade clears the pin; "apply to everyone" reaches pinned businesses; a later "only new" save leaves earlier-pinned businesses on their own snapshot; moving everyone to current terms; a Rs 1 plan; feature and limit checks for unpinned businesses unchanged.
