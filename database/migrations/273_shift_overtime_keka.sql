-- Migration 273: Shift, weekly off, branch holiday lists, overtime policy & requests

-- Weekly off policy on business_settings
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS weekly_off_policy JSONB NOT NULL DEFAULT '{"fixed_days":[0],"nth_rules":[]}'::jsonb;

-- Shift enhancements
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS deduct_break_from_hours BOOLEAN NOT NULL DEFAULT true;

-- Employee branch (for branch-scoped holiday lists)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(business_id, branch_id);

-- Weekly off: business default + optional employee override (JSON)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS weekly_off_override JSONB;

COMMENT ON COLUMN employees.weekly_off_override IS
  'Optional override of business weekly-off policy: { fixed_days: [0], nth_rules: [{week:2,weekday:6}] }';

-- Holiday lists (one per branch; NULL branch = company default)
CREATE TABLE IF NOT EXISTS holiday_lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_holiday_lists_business_branch
  ON holiday_lists(business_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE holidays
  ADD COLUMN IF NOT EXISTS holiday_list_id UUID REFERENCES holiday_lists(id) ON DELETE CASCADE;

-- Shift dated overrides (manager bulk / individual)
CREATE TABLE IF NOT EXISTS employee_shift_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employee_shift_overrides_emp
  ON employee_shift_overrides(employee_id, effective_from DESC);

-- OT policy (single default per business in v1)
CREATE TABLE IF NOT EXISTS ot_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL DEFAULT 'Default OT policy',
  prior_notice_days INTEGER NOT NULL DEFAULT 0,
  allow_backdated BOOLEAN NOT NULL DEFAULT false,
  max_backdate_days INTEGER,
  require_justification BOOLEAN NOT NULL DEFAULT false,
  comp_off_leave_type_id UUID REFERENCES leave_types(id) ON DELETE SET NULL,
  approval_chain JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id)
);

CREATE TABLE IF NOT EXISTS ot_policy_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ot_policy_id UUID NOT NULL REFERENCES ot_policies(id) ON DELETE CASCADE,
  scenario VARCHAR(20) NOT NULL
    CHECK (scenario IN ('working_day', 'weekly_off', 'holiday')),
  pay_mode VARCHAR(20) NOT NULL DEFAULT 'multiplier'
    CHECK (pay_mode IN ('multiplier', 'fixed_lump')),
  multiplier NUMERIC(6,2) DEFAULT 1.5,
  fixed_amount NUMERIC(12,2),
  compensation_type VARCHAR(20) NOT NULL DEFAULT 'monetary'
    CHECK (compensation_type IN ('monetary', 'comp_off', 'employee_choice')),
  comp_off_days NUMERIC(4,2) NOT NULL DEFAULT 1,
  exclude_break BOOLEAN NOT NULL DEFAULT true,
  min_minutes INTEGER NOT NULL DEFAULT 0,
  UNIQUE (ot_policy_id, scenario)
);

CREATE TABLE IF NOT EXISTS overtime_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  request_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  duration_minutes INTEGER NOT NULL,
  total_hours NUMERIC(5,2) NOT NULL,
  scenario VARCHAR(20)
    CHECK (scenario IN ('working_day', 'weekly_off', 'holiday')),
  reason TEXT,
  compensation_choice VARCHAR(20)
    CHECK (compensation_choice IN ('monetary', 'comp_off')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  rejected_at TIMESTAMPTZ,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_overtime_requests_employee
  ON overtime_requests(employee_id, request_date DESC);

CREATE TABLE IF NOT EXISTS overtime_request_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  overtime_request_id UUID NOT NULL REFERENCES overtime_requests(id) ON DELETE CASCADE,
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
  UNIQUE (overtime_request_id, approval_level)
);

CREATE TABLE IF NOT EXISTS ot_payroll_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  overtime_request_id UUID NOT NULL REFERENCES overtime_requests(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied')),
  salary_payment_id UUID REFERENCES salary_payments(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ot_payroll_entries_pending
  ON ot_payroll_entries(business_id, employee_id, status);

-- Seed default holiday list per business from existing holidays
INSERT INTO holiday_lists (business_id, branch_id, name, is_default)
SELECT DISTINCT h.business_id, NULL::uuid, 'Company default', true
FROM holidays h
WHERE h.business_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM holiday_lists hl
    WHERE hl.business_id = h.business_id AND hl.branch_id IS NULL AND hl.is_default = true
  );

UPDATE holidays h
SET holiday_list_id = hl.id
FROM holiday_lists hl
WHERE h.holiday_list_id IS NULL
  AND hl.business_id = h.business_id
  AND hl.branch_id IS NULL
  AND hl.is_default = true;

-- Seed default OT policy per business
INSERT INTO ot_policies (business_id)
SELECT b.id FROM businesses b
WHERE NOT EXISTS (SELECT 1 FROM ot_policies op WHERE op.business_id = b.id);

INSERT INTO ot_policy_rules (ot_policy_id, scenario, pay_mode, multiplier, compensation_type, min_minutes)
SELECT op.id, s.scenario, 'multiplier', s.mult, 'employee_choice', 30
FROM ot_policies op
CROSS JOIN (
  VALUES
    ('working_day', 1.5),
    ('weekly_off', 2.0),
    ('holiday', 2.0)
) AS s(scenario, mult)
ON CONFLICT (ot_policy_id, scenario) DO NOTHING;
