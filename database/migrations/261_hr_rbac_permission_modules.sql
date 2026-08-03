-- Migration 261: Ensure HR RBAC modules are registered and ordered for the roles UI

INSERT INTO permission_modules (module_key, module_name, description, display_order) VALUES
('employees', 'Employees', 'Employee records and profiles', 13),
('attendance', 'Attendance', 'Attendance tracking and roll call', 14),
('leaves', 'Leaves', 'Leave balances and policies', 15),
('leave_requests', 'Leave Requests', 'Leave applications and approvals', 16),
('payroll', 'Payroll', 'Salary payments and payslips', 17),
('recruitment', 'Recruitment', 'Jobs, candidates, interviews, and offers', 18),
('commissions', 'Commissions', 'Employee commissions and incentives', 19),
('hr', 'HR (legacy alias)', 'Legacy HR module alias — prefer Employees', 20)
ON CONFLICT (module_key) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order,
  is_active = true;

-- Sync optional permissions table rows if present (059 artifact; roles UI no longer depends on this)
DO $$
DECLARE
  module_rec RECORD;
  perm_keys TEXT[] := ARRAY['create', 'read', 'update', 'delete', 'approve', 'export'];
  perm_names TEXT[] := ARRAY['Create', 'Read', 'Update', 'Delete', 'Approve', 'Export'];
  i INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'permissions'
  ) THEN
    RETURN;
  END IF;

  FOR module_rec IN
    SELECT id, module_key FROM permission_modules
    WHERE module_key IN (
      'employees', 'attendance', 'leaves', 'leave_requests', 'payroll',
      'recruitment', 'commissions', 'hr'
    )
  LOOP
    FOR i IN 1..array_length(perm_keys, 1) LOOP
      INSERT INTO permissions (module_id, permission_key, permission_name)
      VALUES (module_rec.id, perm_keys[i], perm_names[i])
      ON CONFLICT (module_id, permission_key) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

COMMENT ON TABLE permission_modules IS 'RBAC modules for role_permissions (module_key + boolean flags)';
