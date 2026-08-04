-- Ensure HR plan feature matrix exists (fixes locked HR nav on trial when 253 rows were missing).

INSERT INTO subscription_plan_features (plan_id, feature_id, enabled) VALUES
  ('hr_starter', 'hr_employees', true),
  ('hr_starter', 'hr_attendance', true),
  ('hr_starter', 'settings_multi_user', true),
  ('hr_pro', 'hr_employees', true),
  ('hr_pro', 'hr_attendance', true),
  ('hr_pro', 'hr_payroll', true),
  ('hr_pro', 'hr_leaves', true),
  ('hr_pro', 'hr_employee_portal', true),
  ('hr_pro', 'settings_multi_user', true)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;

DELETE FROM subscription_plan_features WHERE plan_id = 'hr_trial';
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT 'hr_trial', feature_id, enabled
FROM subscription_plan_features
WHERE plan_id = 'hr_pro'
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;

-- hr_free is intentionally empty; do not require registry rows.
UPDATE subscription_plans
SET registry_complete = true
WHERE id IN ('hr_starter', 'hr_pro', 'hr_trial', 'hr_free');

-- Grant missing HR RBAC modules to existing Primary Admin roles (signup race / old function).
INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, pm.module_key, true, true, true, true, true
FROM user_roles ur
CROSS JOIN permission_modules pm
WHERE ur.role_key = 'primary_admin'
  AND ur.is_active = true
  AND pm.is_active = true
  AND pm.module_key IN (
    'employees', 'attendance', 'leaves', 'leave_requests',
    'payroll', 'recruitment', 'commissions', 'hr'
  )
ON CONFLICT (role_id, module_key) DO UPDATE SET
  can_view = true,
  can_add = true,
  can_modify = true,
  can_delete = true,
  can_share = true;
