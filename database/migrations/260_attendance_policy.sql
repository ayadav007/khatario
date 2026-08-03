-- Migration 260: Business attendance policy, late tracking, payroll attendance deductions

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS attendance_policy JSONB;

COMMENT ON COLUMN business_settings.attendance_policy IS
  'Late/LWP rules: detection mode, grace, free lates, deduction modes, daily rate basis, caps';

ALTER TABLE employee_attendance
  ADD COLUMN IF NOT EXISTS late_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_late BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_excused BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_marked_manual BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE salary_payments
  ADD COLUMN IF NOT EXISTS attendance_deduction DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attendance_adjustment_details JSONB;

COMMENT ON COLUMN salary_payments.attendance_deduction IS
  'Deductions from late / LWP rules (suggested from attendance policy, editable at payroll)';
COMMENT ON COLUMN salary_payments.attendance_adjustment_details IS
  'Breakdown lines: late, half_day_lwp, absent_lwp with dates and amounts';
