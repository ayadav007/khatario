-- Track when employee portal credentials were sent
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS portal_invited_at TIMESTAMPTZ;

COMMENT ON COLUMN employees.portal_invited_at IS
  'When portal login credentials were last sent to the employee (email/WhatsApp invite).';
