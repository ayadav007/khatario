-- Migration 267: HR settings Phase 1 (org catalog, payroll shell, hiring, portal)

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS hr_org_catalog JSONB NOT NULL DEFAULT '{"departments":[],"designations":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS hr_payroll_settings JSONB NOT NULL DEFAULT '{"monthly_pay_day":null}'::jsonb,
  ADD COLUMN IF NOT EXISTS hr_hiring_settings JSONB NOT NULL DEFAULT '{"auto_send_onboarding_invite":false}'::jsonb,
  ADD COLUMN IF NOT EXISTS hr_portal_settings JSONB NOT NULL DEFAULT '{"kiosk_enabled":true}'::jsonb;

COMMENT ON COLUMN business_settings.hr_org_catalog IS
  'HR org master lists: departments and designations for employee forms';
COMMENT ON COLUMN business_settings.hr_payroll_settings IS
  'HR payroll preferences: pay day, future statutory flags';
COMMENT ON COLUMN business_settings.hr_hiring_settings IS
  'Recruitment defaults: auto onboarding invite, etc.';
COMMENT ON COLUMN business_settings.hr_portal_settings IS
  'Employee self-service portal: kiosk toggle and future portal options';
