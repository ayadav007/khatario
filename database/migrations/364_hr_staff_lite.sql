-- Migration 364: HR Staff Lite — complimentary with every Billing package (incl. Free).
-- 30 employees, simple payroll (employees + attendance + payroll). Full leave/portal stay on paid HR.

INSERT INTO subscription_plans (
  id, name, display_name, description,
  price_monthly, price_yearly, price_3year, currency, features,
  is_active, sort_order, registry_complete, product_line
) VALUES (
  'hr_staff_lite',
  'hr_staff_lite',
  'HR Lite',
  'Included with Billing: up to 30 staff, attendance, and simple salary. Upgrade to HR Pro for leave, portal, and statutory payroll.',
  0, 0, 0, 'INR',
  '{"limits":{"max_users":1,"max_employees":30},"features":{}}'::jsonb,
  true, 9, true, 'hr'
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  price_3year = EXCLUDED.price_3year,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  registry_complete = true,
  product_line = EXCLUDED.product_line,
  features = EXCLUDED.features,
  updated_at = CURRENT_TIMESTAMP;

DELETE FROM subscription_plan_features WHERE plan_id = 'hr_staff_lite';
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled) VALUES
  ('hr_staff_lite', 'hr_employees', true),
  ('hr_staff_lite', 'hr_attendance', true),
  ('hr_staff_lite', 'hr_payroll', true),
  ('hr_staff_lite', 'settings_multi_user', true)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;

DELETE FROM subscription_plan_limits WHERE plan_id = 'hr_staff_lite';
INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value) VALUES
  ('hr_staff_lite', 'max_users', 1),
  ('hr_staff_lite', 'max_employees', 30),
  ('hr_staff_lite', 'max_attendance_records_per_month', 900),
  ('hr_staff_lite', 'max_payroll_records_per_month', 60),
  ('hr_staff_lite', 'max_salary_advances_per_month', 60),
  ('hr_staff_lite', 'max_employee_expenses_per_month', 120),
  ('hr_staff_lite', 'max_commissions_per_month', 120)
ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = EXCLUDED.limit_value;

-- Enable HR for every business that already has Billing.
INSERT INTO business_modules (business_id, module_key, enabled, source)
SELECT bm.business_id, 'hr', true, 'complimentary'
FROM business_modules bm
WHERE bm.module_key = 'billing'
  AND bm.enabled = true
ON CONFLICT (business_id, module_key) DO UPDATE SET
  enabled = true,
  source = CASE
    WHEN business_modules.enabled = true
      AND business_modules.source IS DISTINCT FROM 'complimentary'
      THEN business_modules.source
    ELSE 'complimentary'
  END,
  enabled_at = CASE
    WHEN business_modules.enabled = true THEN business_modules.enabled_at
    ELSE CURRENT_TIMESTAMP
  END;

-- Insert HR Lite where Billing businesses have no HR subscription row yet.
INSERT INTO business_module_subscriptions (
  business_id, module_key, plan_id, status, start_date, trial_end_date, end_date
)
SELECT bm.business_id, 'hr', 'hr_staff_lite', 'active', CURRENT_DATE, NULL, NULL
FROM business_modules bm
WHERE bm.module_key = 'billing'
  AND bm.enabled = true
  AND NOT EXISTS (
    SELECT 1
    FROM business_module_subscriptions hms
    WHERE hms.business_id = bm.business_id
      AND hms.module_key = 'hr'
  );

-- Upgrade empty post-trial HR Free to HR Lite when Billing is enabled (never touch paid/trial HR).
UPDATE business_module_subscriptions hms
SET plan_id = 'hr_staff_lite',
    status = 'active',
    trial_end_date = NULL,
    end_date = NULL,
    grace_period_end = NULL,
    cancel_at_period_end = false,
    cancelled_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE hms.module_key = 'hr'
  AND hms.plan_id = 'hr_free'
  AND EXISTS (
    SELECT 1
    FROM business_modules bm
    WHERE bm.business_id = hms.business_id
      AND bm.module_key = 'billing'
      AND bm.enabled = true
  );
