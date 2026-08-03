-- Migration 248: Employee self-service portal feature registry entry

INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon)
VALUES (
  'hr_employee_portal',
  'hr',
  'Employee Self-Service Portal',
  'Public employee portal at /{slug}/employees — login, attendance, leaves, payslips',
  NULL,
  0,
  true,
  false
)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT sp.id, 'hr_employee_portal', TRUE
FROM subscription_plans sp
ON CONFLICT (plan_id, feature_id) DO NOTHING;
