-- Phase 3: Statutory payroll — PF / ESI / PT fields on employees + salary payments

-- Employee statutory identifiers / applicability
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS uan VARCHAR(20),
  ADD COLUMN IF NOT EXISTS esi_ip_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS pf_account_no VARCHAR(40),
  ADD COLUMN IF NOT EXISTS pf_applicable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS esi_applicable BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN employees.uan IS 'EPFO Universal Account Number';
COMMENT ON COLUMN employees.esi_ip_number IS 'ESIC IP number';
COMMENT ON COLUMN employees.pf_applicable IS 'When false, skip PF deduction even if business PF is enabled';
COMMENT ON COLUMN employees.esi_applicable IS 'When false, skip ESI even if business ESI is enabled';

-- Payment-period statutory amounts (employer lines are cost/display; not in net)
ALTER TABLE salary_payments
  ADD COLUMN IF NOT EXISTS employer_provident_fund DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS esi_employee DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS esi_employer DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pf_wage DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS esi_wage DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS statutory_breakdown JSONB;

COMMENT ON COLUMN salary_payments.employer_provident_fund IS 'Employer PF contribution (display/cost; excluded from net salary)';
COMMENT ON COLUMN salary_payments.esi_employee IS 'Employee ESI deduction (included in total_deductions)';
COMMENT ON COLUMN salary_payments.esi_employer IS 'Employer ESI contribution (display/cost; excluded from net)';
COMMENT ON COLUMN salary_payments.statutory_breakdown IS 'Rates/ceilings used for this payment (audit)';

-- Optional export audit log
CREATE TABLE IF NOT EXISTS statutory_export_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  salary_month VARCHAR(20) NOT NULL,
  export_type VARCHAR(30) NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  generated_by UUID REFERENCES users(id),
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_statutory_export_log_business_month
  ON statutory_export_log (business_id, salary_month);
