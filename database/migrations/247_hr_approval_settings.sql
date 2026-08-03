-- Migration 247: Per-business HR approval routing (leave + expense)

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS hr_approval_settings JSONB NOT NULL DEFAULT '{
    "leave_mode": "permission_any",
    "expense_mode": "permission_any",
    "allow_hr_override": true
  }'::jsonb;

COMMENT ON COLUMN business_settings.hr_approval_settings IS
  'HR approval routing: leave_mode / expense_mode = permission_any | manager_direct_reports | manager_only; allow_hr_override lets users with update permission approve any request when mode is manager-scoped';
