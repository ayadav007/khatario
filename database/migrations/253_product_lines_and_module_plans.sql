-- Migration 253: Product lines (Billing / HR / Connect) and module-specific plans

-- ---------------------------------------------------------------------------
-- Schema: product_line on businesses + subscription_plans
-- ---------------------------------------------------------------------------
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS product_line VARCHAR(20) NOT NULL DEFAULT 'billing';

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS product_line VARCHAR(20) NOT NULL DEFAULT 'billing';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_product_line_check'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_product_line_check
      CHECK (product_line IN ('billing', 'hr', 'connect'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_product_line_check'
  ) THEN
    ALTER TABLE subscription_plans
      ADD CONSTRAINT subscription_plans_product_line_check
      CHECK (product_line IN ('billing', 'hr', 'connect'));
  END IF;
END $$;

UPDATE subscription_plans SET product_line = 'billing' WHERE product_line IS NULL OR product_line = '';

COMMENT ON COLUMN businesses.product_line IS 'Signup product line: billing | hr | connect';
COMMENT ON COLUMN subscription_plans.product_line IS 'Which product line this plan belongs to';

-- ---------------------------------------------------------------------------
-- HR plans: Starter (attendance), Pro (payroll), trial, post-trial free
-- ---------------------------------------------------------------------------
INSERT INTO subscription_plans (
  id, name, display_name, description,
  price_monthly, price_yearly, currency, features,
  is_active, sort_order, registry_complete, product_line
) VALUES
(
  'hr_starter',
  'hr_starter',
  'HR Starter',
  'Employee records and attendance tracking for growing teams.',
  199, 1990, 'INR',
  '{"limits":{"max_users":5,"max_employees":50},"features":{}}'::jsonb,
  true, 10, true, 'hr'
),
(
  'hr_pro',
  'hr_pro',
  'HR Pro',
  'Full HR: payroll, leave management, and employee self-service portal.',
  499, 4990, 'INR',
  '{"limits":{"max_users":15,"max_employees":200},"features":{}}'::jsonb,
  true, 11, true, 'hr'
),
(
  'hr_trial',
  'hr_trial',
  'HR Trial',
  '30-day trial with full HR Pro features.',
  0, 0, 'INR',
  '{"limits":{"max_users":15,"max_employees":200},"features":{}}'::jsonb,
  true, 12, true, 'hr'
),
(
  'hr_free',
  'hr_free',
  'HR Free',
  'Limited access after HR trial — upgrade to Starter or Pro to continue.',
  0, 0, 'INR',
  '{"limits":{"max_users":1,"max_employees":0},"features":{}}'::jsonb,
  true, 13, true, 'hr'
),
(
  'connect',
  'connect',
  'Connect',
  'WhatsApp CRM platform — no platform fee; enable Bot or Send Message add-ons.',
  0, 0, 'INR',
  '{"limits":{"max_users":5,"max_whatsapp_per_day":0},"features":{}}'::jsonb,
  true, 20, true, 'connect'
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  product_line = EXCLUDED.product_line,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  registry_complete = EXCLUDED.registry_complete,
  updated_at = CURRENT_TIMESTAMP;

-- HR Starter: employees + attendance
DELETE FROM subscription_plan_features WHERE plan_id = 'hr_starter';
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled) VALUES
  ('hr_starter', 'hr_employees', true),
  ('hr_starter', 'hr_attendance', true),
  ('hr_starter', 'settings_multi_user', true)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;

-- HR Pro: full HR suite
DELETE FROM subscription_plan_features WHERE plan_id = 'hr_pro';
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled) VALUES
  ('hr_pro', 'hr_employees', true),
  ('hr_pro', 'hr_attendance', true),
  ('hr_pro', 'hr_payroll', true),
  ('hr_pro', 'hr_leaves', true),
  ('hr_pro', 'hr_employee_portal', true),
  ('hr_pro', 'settings_multi_user', true)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;

-- HR Trial: same as Pro
DELETE FROM subscription_plan_features WHERE plan_id = 'hr_trial';
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT 'hr_trial', feature_id, enabled
FROM subscription_plan_features
WHERE plan_id = 'hr_pro'
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;

-- HR Free: no HR features (upgrade required)
DELETE FROM subscription_plan_features WHERE plan_id = 'hr_free';

-- Connect: settings only; WhatsApp via add-ons
DELETE FROM subscription_plan_features WHERE plan_id = 'connect';
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled) VALUES
  ('connect', 'settings_whatsapp', true),
  ('connect', 'settings_multi_user', true)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;

-- Plan limits (registry)
DELETE FROM subscription_plan_limits WHERE plan_id IN ('hr_starter', 'hr_pro', 'hr_trial', 'hr_free', 'connect');

INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value) VALUES
  ('hr_starter', 'max_users', 5),
  ('hr_starter', 'max_employees', 50),
  ('hr_pro', 'max_users', 15),
  ('hr_pro', 'max_employees', 200),
  ('hr_trial', 'max_users', 15),
  ('hr_trial', 'max_employees', 200),
  ('hr_free', 'max_users', 1),
  ('hr_free', 'max_employees', 0),
  ('connect', 'max_users', 5),
  ('connect', 'max_whatsapp_per_day', 0)
ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = EXCLUDED.limit_value;
