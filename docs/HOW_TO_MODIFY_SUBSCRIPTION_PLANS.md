# How to change subscription plans

A plan is a row in `subscription_plans` plus its features and limits in separate tables. A customer's plan is a row per product in `business_module_subscriptions`. The old `business_subscriptions` table and the JSON `features` column on `subscription_plans` are not used to decide access any more.

## The tables

| Table | What it holds |
|---|---|
| `subscription_plans` | One row per plan: `id`, `display_name`, prices (`price_monthly`, `price_yearly`, `price_3year`), `product_line` (billing, hr, connect, crm), `is_active`, `is_public`, `bundled_hr_plan_id`, `description`. |
| `platform_features` | Every feature that can be switched on for a plan (`id` such as `web_access`, `hr_payroll`). |
| `subscription_plan_features` | `(plan_id, feature_id, enabled)`: which features a plan has. A missing row means the plan does not have the feature. |
| `platform_limits` | Every limit with its `default_value` (`-1` is unlimited, `0` is not allowed). |
| `subscription_plan_limits` | `(plan_id, limit_key, limit_value)`: a plan's own value. Without a row the plan uses the platform default. |
| `business_module_subscriptions` | One row per business and product: `plan_id`, `status` (active, trial, expired, cancelled), `start_date`, `end_date`, `billing_cycle`. |
| `platform_admin_logs` | The admin audit log. Plan edits made in the admin screen are recorded here. |

The current Billing plans are Free, Starter, Growth and Business (ids `free`, `billing_starter`, `billing_growth`, `billing_business`), plus the signup `trial`. The older `growth` and `business` plans stay active for businesses already on them. HR plans: `hr_staff_lite` (HR Lite), `hr_starter`, `hr_pro`. A Billing plan bundles an HR plan through `bundled_hr_plan_id`: Starter includes HR Lite, Growth includes HR Starter, Business includes HR Pro, Free includes none.

## Normal way: Admin, then Plans

Use the feature and limit screens in the platform admin (Plans). Before it saves, the screen tells you how many businesses are on the plan and asks you to confirm: "This changes the plan for N businesses right away." There is no plan versioning: every business on the plan gets the new features and limits immediately, and nothing is grandfathered. Every save is written to `platform_admin_logs` with your admin id and the values before and after.

If the number of businesses changes while you are on the screen, the save is refused with the new number; look at it and save again.

## Direct SQL (local or test database only)

Do not run these on staging or production: they skip the confirmation and the audit log.

```sql
-- Turn a feature on for a plan
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
VALUES ('free', 'hr_payroll', true)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;

-- Turn it off
DELETE FROM subscription_plan_features WHERE plan_id = 'free' AND feature_id = 'hr_payroll';

-- Change a limit (-1 unlimited, 0 not allowed)
INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
VALUES ('free', 'max_whatsapp_per_day', 10)
ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = 10;

-- See a plan's features and limits
SELECT feature_id FROM subscription_plan_features WHERE plan_id = 'free' AND enabled ORDER BY 1;
SELECT limit_key, limit_value FROM subscription_plan_limits WHERE plan_id = 'free' ORDER BY 1;
```

## Put one test business on a plan

Use the admin screen (Businesses, then the business, then Subscription). In SQL, on the local database:

```sql
SELECT bms.module_key, bms.plan_id, bms.status, bms.end_date, sp.display_name
FROM business_module_subscriptions bms
JOIN subscription_plans sp ON sp.id = bms.plan_id
WHERE bms.business_id = '<business id>';

UPDATE business_module_subscriptions
SET plan_id = 'billing_growth', status = 'active', end_date = CURRENT_DATE + 30
WHERE business_id = '<business id>' AND module_key = 'billing';
```

## Seed values and migrations

Plan seeds live in the numbered files under `database/migrations/` (for example 360, 386, 387). They are applied once by the migration runner. Do not re-run an old migration to "reset" plans: it overwrites changes made in the admin screen. Change a plan for good by editing it in the admin screen; to change what a new database starts with, add a new migration.

## After a change

- The app caches a business's plan for a short time. The admin screens clear the cache on save; after direct SQL, restart the app or wait a few minutes.
- Access checks read the business's plan from `business_module_subscriptions` and the plan's rows in the tables above (`hasFeature`, `checkLimit`). Whether a plan is usable today (not ended, not past grace) is decided by `getSubscriptionUsability` in `lib/subscription/effective-plan.ts`.
- Plan tier (which plan is higher than which) comes from `lib/subscription/plan-tier.ts`, not from the price.
