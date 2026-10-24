-- HR plan ladder.
--   HR Lite (free with every Billing plan): add employees, manual attendance, pay salary.
--   HR Starter: + Khatario Staff app check-in, shifts & policies, payroll setup, expenses & commissions.
--   HR Pro: + leave, employee portal, hiring, and the HR workspace (dashboard, reports, exits, performance).
-- Before this, anything beyond Lite was decided in code by "does the plan have leave or the portal",
-- so HR Starter could not be given anything. Each area is now its own switch in Admin → Plans.
-- Existing Starter businesses gain features; Lite businesses lose the Staff app, expenses and commissions.

INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon) VALUES
  ('hr_staff_app', 'hr', 'Khatario Staff app',
   'Staff check in from their own phone: GPS, office Wi-Fi, face check, office sites and the review queue',
   '/settings/attendance-policy', 5, true, false),
  ('hr_shifts', 'hr', 'Shifts & attendance rules',
   'Shifts and roster, holiday lists, overtime policy and attendance corrections', '/settings/shifts', 6, true, false),
  ('hr_payroll_setup', 'hr', 'Payroll setup',
   'Salary structure and components, payroll settings, PAN and Aadhaar on employees', '/settings/payroll', 7, true, false),
  ('hr_commissions', 'hr', 'Expenses & commissions',
   'Employee expense claims, sales commissions and commission rules', '/employees/commissions', 8, true, false),
  ('hr_recruitment', 'hr', 'Hiring & onboarding',
   'Recruitment, onboarding templates and offer letters', '/employees/recruitment', 9, true, false),
  ('hr_advanced', 'hr', 'HR workspace',
   'HR dashboard, reports, documents, exits, performance, targets, tasks, engagement and org chart', '/hr/dashboard', 10, true, false)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  route_path = EXCLUDED.route_path,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  is_addon = false,
  updated_at = CURRENT_TIMESTAMP;

UPDATE platform_features
SET label = 'Daily attendance', description = 'Mark attendance for each employee, day by day', updated_at = CURRENT_TIMESTAMP
WHERE id = 'hr_attendance';
UPDATE platform_features
SET label = 'Pay salary', description = 'Record salary payments and salary advances', updated_at = CURRENT_TIMESTAMP
WHERE id = 'hr_payroll';

-- Plan assignments. Lite keeps exactly employees, attendance and salary.
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT p.plan_id, p.feature_id, true
FROM (VALUES
  ('hr_starter', 'hr_payroll'),
  ('hr_starter', 'hr_staff_app'),
  ('hr_starter', 'hr_shifts'),
  ('hr_starter', 'hr_payroll_setup'),
  ('hr_starter', 'hr_commissions'),
  ('hr_pro', 'hr_staff_app'),
  ('hr_pro', 'hr_shifts'),
  ('hr_pro', 'hr_payroll_setup'),
  ('hr_pro', 'hr_commissions'),
  ('hr_pro', 'hr_recruitment'),
  ('hr_pro', 'hr_advanced'),
  ('hr_trial', 'hr_staff_app'),
  ('hr_trial', 'hr_shifts'),
  ('hr_trial', 'hr_payroll_setup'),
  ('hr_trial', 'hr_commissions'),
  ('hr_trial', 'hr_recruitment'),
  ('hr_trial', 'hr_advanced')
) AS p(plan_id, feature_id)
WHERE EXISTS (SELECT 1 FROM subscription_plans sp WHERE sp.id = p.plan_id)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;

DELETE FROM subscription_plan_features
WHERE plan_id = 'hr_staff_lite'
  AND feature_id IN ('hr_leaves', 'hr_employee_portal', 'hr_staff_app', 'hr_shifts', 'hr_payroll_setup',
                     'hr_commissions', 'hr_recruitment', 'hr_advanced');

-- 30 staff × 31 days is 930 records; 900 refused attendance in long months.
UPDATE subscription_plan_limits SET limit_value = 1000, updated_at = CURRENT_TIMESTAMP
WHERE plan_id = 'hr_staff_lite' AND limit_key = 'max_attendance_records_per_month' AND limit_value < 1000;

UPDATE subscription_plans SET description = v.description, updated_at = CURRENT_TIMESTAMP
FROM (VALUES
  ('hr_staff_lite', 'Included with every Billing plan: add up to 30 staff, mark attendance and pay salary.'),
  ('hr_starter', 'Everything in HR Lite plus the Khatario Staff app, shifts and holidays, payroll setup, expenses and commissions.'),
  ('hr_pro', 'Everything in HR Starter plus leave, the employee portal, hiring and onboarding, and HR reports.')
) AS v(id, description)
WHERE subscription_plans.id = v.id;

-- Pricing page wording (columns from migration 385).
UPDATE platform_features pf
SET pricing_label = v.label, pricing_rank = v.rank, show_on_pricing = true, updated_at = CURRENT_TIMESTAMP
FROM (VALUES
  ('hr_employees', 'Add employees', 1),
  ('hr_attendance', 'Daily attendance', 2),
  ('hr_payroll', 'Pay salary & advances', 3),
  ('hr_staff_app', 'Khatario Staff app (GPS, Wi-Fi, face check-in)', 4),
  ('hr_shifts', 'Shifts, holidays & overtime', 5),
  ('hr_payroll_setup', 'Salary structure & payroll setup', 6),
  ('hr_commissions', 'Employee expenses & commissions', 7),
  ('hr_leaves', 'Leave management', 8),
  ('hr_employee_portal', 'Employee self-service portal', 9),
  ('hr_recruitment', 'Hiring, onboarding & offer letters', 10),
  ('hr_advanced', 'HR dashboard, reports, exits & performance', 11)
) AS v(id, label, rank)
WHERE pf.id = v.id;
