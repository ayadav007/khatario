-- Leave requests, employee tasks and performance reviews had no subscription_plan_limits rows on any
-- HR plan, so the registry default of 0 refused them on HR Pro and HR Trial, the plans that include
-- them (staging QA F-026; same cause as migration 432). Pro and Trial are unlimited. HR Lite and
-- HR Starter do not include these features, so they get no rows. Rows an admin already set are kept.

INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value) VALUES
  ('hr_pro', 'max_leave_requests_per_month', -1),
  ('hr_pro', 'max_employee_tasks_per_month', -1),
  ('hr_pro', 'max_performance_reviews_per_month', -1),
  ('hr_trial', 'max_leave_requests_per_month', -1),
  ('hr_trial', 'max_employee_tasks_per_month', -1),
  ('hr_trial', 'max_performance_reviews_per_month', -1)
ON CONFLICT (plan_id, limit_key) DO NOTHING;
