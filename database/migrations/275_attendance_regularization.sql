-- Migration 275: Keka-style attendance regularization (manager approval)

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS regularization_settings JSONB;

COMMENT ON COLUMN business_settings.regularization_settings IS
  'Employee attendance regularization: enabled, edit permissions, frequency/backdate limits, partial threshold';

CREATE TABLE IF NOT EXISTS attendance_regularization_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_id UUID REFERENCES employee_attendance(id) ON DELETE SET NULL,
  attendance_date DATE NOT NULL,
  request_type VARCHAR(40) NOT NULL,
  original_check_in TIMESTAMPTZ,
  original_check_out TIMESTAMPTZ,
  requested_check_in TIMESTAMPTZ,
  requested_check_out TIMESTAMPTZ,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  approver_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT attendance_regularization_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_att_reg_req_employee_date
  ON attendance_regularization_requests(employee_id, attendance_date DESC);

CREATE INDEX IF NOT EXISTS idx_att_reg_req_business_pending
  ON attendance_regularization_requests(business_id, status)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_att_reg_req_one_pending_per_type
  ON attendance_regularization_requests(employee_id, attendance_date, request_type)
  WHERE status = 'pending';
