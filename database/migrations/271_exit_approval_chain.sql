-- Migration 271: Multi-level exit approval chain (resignations only)

ALTER TABLE employee_exits
  DROP CONSTRAINT IF EXISTS employee_exits_status_chk;

ALTER TABLE employee_exits
  ADD CONSTRAINT employee_exits_status_chk CHECK (
    status IN (
      'initiated',
      'pending_approval',
      'approval_on_hold',
      'approved',
      'in_notice',
      'completed',
      'cancelled'
    )
  );

CREATE TABLE IF NOT EXISTS employee_exit_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exit_id UUID NOT NULL REFERENCES employee_exits(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  approval_level INTEGER NOT NULL,
  level_label VARCHAR(120),
  role_type VARCHAR(30) NOT NULL
    CHECK (role_type IN ('reporting_manager', 'department_head', 'specific_employee', 'hr')),
  approver_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'awaiting', 'approved', 'on_hold', 'rejected', 'skipped')),
  hold_reason TEXT,
  comments TEXT,
  exception_granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  exception_granted_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exit_id, approval_level)
);

CREATE INDEX IF NOT EXISTS idx_employee_exit_approvals_exit
  ON employee_exit_approvals(exit_id, approval_level);

CREATE INDEX IF NOT EXISTS idx_employee_exit_approvals_approver
  ON employee_exit_approvals(approver_user_id, status)
  WHERE status IN ('awaiting', 'on_hold');

COMMENT ON TABLE employee_exit_approvals IS
  'Sequential exit approval chain for resignations; approvers resolved from business template + org chart';
