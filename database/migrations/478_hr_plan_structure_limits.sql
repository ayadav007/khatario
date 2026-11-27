-- HR plan structure limits: holidays, shifts, designations, departments.
-- No HR plan had rows for these, so even HR Pro fell back to the platform defaults (10/5/10/5).
-- hr_pro and hr_trial: unlimited (-1). hr_starter and hr_staff_lite: holidays 30, shifts 10,
-- designations 20, departments 10. Idempotent; skips a plan or a limit key the database lacks.
-- (max_departments is resolved through the HR plan: LIMIT_OWNER_MODULE.departments = 'hr'.)

INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
SELECT sp.id, pl.limit_key,
  CASE
    WHEN sp.id IN ('hr_pro', 'hr_trial') THEN -1
    WHEN pl.limit_key = 'max_holidays' THEN 30
    WHEN pl.limit_key = 'max_shifts' THEN 10
    WHEN pl.limit_key = 'max_designations' THEN 20
    WHEN pl.limit_key = 'max_departments' THEN 10
  END
FROM subscription_plans sp
CROSS JOIN platform_limits pl
WHERE sp.id IN ('hr_pro', 'hr_trial', 'hr_starter', 'hr_staff_lite')
  AND pl.limit_key IN ('max_holidays', 'max_shifts', 'max_designations', 'max_departments')
ON CONFLICT (plan_id, limit_key) DO NOTHING;
