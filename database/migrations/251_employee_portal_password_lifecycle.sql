-- Phase 5: employee portal password lifecycle
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.must_change_password IS
  'When true, employee portal user must set a new password before using the app.';

CREATE TABLE IF NOT EXISTS employee_portal_otps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  phone VARCHAR(20) NOT NULL,
  otp_code VARCHAR(6) NOT NULL,
  purpose VARCHAR(32) NOT NULL DEFAULT 'password_reset',
  expires_at TIMESTAMPTZ NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employee_portal_otps_employee
  ON employee_portal_otps(employee_id, expires_at DESC)
  WHERE is_used = false;

CREATE INDEX IF NOT EXISTS idx_employee_portal_otps_phone
  ON employee_portal_otps(business_id, phone, expires_at DESC);

COMMENT ON TABLE employee_portal_otps IS
  'OTP codes for employee portal forgot-password flow (WhatsApp/SMS delivery).';
