-- HR Starter, HR Pro and HR Trial had no rows for the monthly HR limits, so they fell back to the
-- registry default of 0: marking attendance or paying salary was refused ("limit (0/0)") on every
-- plan except HR Lite, including the HR Pro bundled with the Billing trial (staging QA F-012).
-- Pro and Trial are unlimited; Starter scales HR Lite's numbers to its 50 staff.
-- Rows an admin already set are kept.

INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value) VALUES
  ('hr_starter', 'max_attendance_records_per_month', 1600),
  ('hr_starter', 'max_payroll_records_per_month', 100),
  ('hr_starter', 'max_salary_advances_per_month', 100),
  ('hr_starter', 'max_employee_expenses_per_month', 200),
  ('hr_starter', 'max_commissions_per_month', 200),
  ('hr_pro', 'max_attendance_records_per_month', -1),
  ('hr_pro', 'max_payroll_records_per_month', -1),
  ('hr_pro', 'max_salary_advances_per_month', -1),
  ('hr_pro', 'max_employee_expenses_per_month', -1),
  ('hr_pro', 'max_commissions_per_month', -1),
  ('hr_trial', 'max_attendance_records_per_month', -1),
  ('hr_trial', 'max_payroll_records_per_month', -1),
  ('hr_trial', 'max_salary_advances_per_month', -1),
  ('hr_trial', 'max_employee_expenses_per_month', -1),
  ('hr_trial', 'max_commissions_per_month', -1)
ON CONFLICT (plan_id, limit_key) DO NOTHING;
