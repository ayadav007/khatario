-- Migration 249: Employee portal sessions (ESS login cookie backing store)

CREATE TABLE IF NOT EXISTS employee_portal_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  session_token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employee_portal_sessions_token
  ON employee_portal_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_employee_portal_sessions_employee
  ON employee_portal_sessions(employee_id);

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS portal_last_login_at TIMESTAMP;

COMMENT ON TABLE employee_portal_sessions IS 'DB-backed sessions for /{slug}/employees employee self-service portal';
