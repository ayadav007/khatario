-- Migration 272: Keka-style leave plans, policy rules, encashment, year-end

CREATE TABLE IF NOT EXISTS leave_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL DEFAULT 'Default leave plan',
  calendar_year_start_month INTEGER NOT NULL DEFAULT 1
    CHECK (calendar_year_start_month BETWEEN 1 AND 12),
  policy_document_url TEXT,
  application_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  leave_approval_chain JSONB NOT NULL DEFAULT '[]'::jsonb,
  encashment_daily_rate_basis VARCHAR(30) NOT NULL DEFAULT 'basic_per_30'
    CHECK (encashment_daily_rate_basis IN ('basic_per_30', 'gross_per_30')),
  is_default BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_plans_default_business
  ON leave_plans(business_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_leave_plans_business ON leave_plans(business_id);

CREATE TABLE IF NOT EXISTS leave_plan_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  leave_plan_id UUID NOT NULL REFERENCES leave_plans(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  annual_quota DECIMAL(5,2) NOT NULL DEFAULT 0,
  accrual_mode VARCHAR(20) NOT NULL DEFAULT 'lump_sum'
    CHECK (accrual_mode IN ('lump_sum', 'monthly', 'quarterly')),
  accrual_day_of_month INTEGER NOT NULL DEFAULT 1
    CHECK (accrual_day_of_month BETWEEN 1 AND 28),
  prorate_on_join BOOLEAN NOT NULL DEFAULT true,
  rounding_mode VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (rounding_mode IN ('none', 'half_day', 'full_day')),
  employee_can_apply BOOLEAN NOT NULL DEFAULT true,
  min_notice_days INTEGER NOT NULL DEFAULT 0,
  allow_backdated BOOLEAN NOT NULL DEFAULT false,
  max_future_days INTEGER,
  blocked_in_probation BOOLEAN NOT NULL DEFAULT false,
  blocked_in_notice_period BOOLEAN NOT NULL DEFAULT true,
  requires_comment BOOLEAN NOT NULL DEFAULT false,
  requires_attachment BOOLEAN NOT NULL DEFAULT false,
  attachment_min_days DECIMAL(5,2),
  sandwich_enabled BOOLEAN NOT NULL DEFAULT false,
  sandwich_count_weekends BOOLEAN NOT NULL DEFAULT true,
  sandwich_count_holidays BOOLEAN NOT NULL DEFAULT true,
  year_end_treatment VARCHAR(30) NOT NULL DEFAULT 'carry_forward'
    CHECK (year_end_treatment IN ('expire', 'carry_forward', 'encash', 'carry_or_encash')),
  max_carry_forward_days DECIMAL(5,2),
  carry_forward_expiry_months INTEGER,
  allow_negative_balance BOOLEAN NOT NULL DEFAULT false,
  negative_balance_treatment VARCHAR(20) NOT NULL DEFAULT 'reset'
    CHECK (negative_balance_treatment IN ('reset', 'carry_deficit')),
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (leave_plan_id, leave_type_id)
);

CREATE INDEX IF NOT EXISTS idx_leave_plan_types_plan ON leave_plan_types(leave_plan_id);

CREATE TABLE IF NOT EXISTS leave_plan_restrictions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  leave_plan_id UUID NOT NULL REFERENCES leave_plans(id) ON DELETE CASCADE,
  restriction_type VARCHAR(30) NOT NULL DEFAULT 'no_consecutive'
    CHECK (restriction_type IN ('no_consecutive', 'block_combination')),
  leave_type_id_a UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  leave_type_id_b UUID REFERENCES leave_types(id) ON DELETE CASCADE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leave_plan_restrictions_plan ON leave_plan_restrictions(leave_plan_id);

CREATE TABLE IF NOT EXISTS leave_encashment_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  leave_year INTEGER NOT NULL,
  days DECIMAL(5,2) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'cancelled')),
  salary_payment_id UUID REFERENCES salary_payments(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_leave_encashment_pending
  ON leave_encashment_entries(business_id, employee_id, status)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS leave_year_end_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  leave_year INTEGER NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, leave_year)
);

CREATE TABLE IF NOT EXISTS leave_accrual_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  accrual_month DATE NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, accrual_month)
);

CREATE TABLE IF NOT EXISTS leave_request_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  leave_request_id UUID NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
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
  UNIQUE (leave_request_id, approval_level)
);

CREATE INDEX IF NOT EXISTS idx_leave_request_approvals_request
  ON leave_request_approvals(leave_request_id, approval_level);

-- Seed default plan from existing leave_types per business
INSERT INTO leave_plans (business_id, name, is_default)
SELECT DISTINCT lt.business_id, 'Default leave plan', true
FROM leave_types lt
WHERE lt.business_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM leave_plans lp WHERE lp.business_id = lt.business_id AND lp.is_default = true
  );

INSERT INTO leave_plan_types (
  leave_plan_id, leave_type_id, annual_quota, year_end_treatment,
  max_carry_forward_days, requires_approval, sort_order
)
SELECT lp.id, lt.id,
       COALESCE(lt.max_days_per_year, 0)::decimal,
       CASE WHEN lt.carry_forward THEN 'carry_forward' ELSE 'expire' END,
       lt.max_carry_forward_days::decimal,
       COALESCE(lt.requires_approval, true),
       ROW_NUMBER() OVER (PARTITION BY lp.id ORDER BY lt.leave_code)
FROM leave_types lt
INNER JOIN leave_plans lp ON lp.business_id = lt.business_id AND lp.is_default = true
WHERE lt.is_active = true
ON CONFLICT (leave_plan_id, leave_type_id) DO NOTHING;

COMMENT ON TABLE leave_plans IS 'Default leave plan per business (v1: single plan)';
COMMENT ON TABLE leave_plan_types IS 'Per leave type policy within a plan';
