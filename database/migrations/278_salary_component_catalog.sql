-- HR-configurable salary components (catalog + structure lines + payment snapshot)

CREATE TABLE IF NOT EXISTS salary_component_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  component_type VARCHAR(20) NOT NULL CHECK (component_type IN ('earning', 'deduction')),
  calculation_type VARCHAR(30) NOT NULL DEFAULT 'fixed'
    CHECK (calculation_type IN ('fixed', 'percent_basic', 'percent_gross')),
  /** Maps to legacy salary_structures columns when set (BASIC, HRA, …). */
  system_key VARCHAR(40),
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, code)
);

CREATE INDEX IF NOT EXISTS idx_salary_comp_def_business
  ON salary_component_definitions (business_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS salary_structure_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  structure_id UUID NOT NULL REFERENCES salary_structures(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES salary_component_definitions(id) ON DELETE RESTRICT,
  /** Amount (₹) or percent depending on component calculation_type. */
  value DECIMAL(12,4) NOT NULL DEFAULT 0,
  UNIQUE (structure_id, component_id)
);

CREATE INDEX IF NOT EXISTS idx_salary_structure_lines_structure
  ON salary_structure_lines (structure_id);

-- Snapshot of lines on each salary payment (for payslip / audit)
ALTER TABLE salary_payments
  ADD COLUMN IF NOT EXISTS component_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON TABLE salary_component_definitions IS 'Business salary component catalog editable by HR';
COMMENT ON TABLE salary_structure_lines IS 'Per-employee structure amounts for catalog components';
COMMENT ON COLUMN salary_payments.component_breakdown IS 'Array of {code,name,type,amount} used for this payment';
