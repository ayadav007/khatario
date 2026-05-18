-- Migration 082: Provisions Management
-- Creates tables for managing provisions (bad debts, warranty, employee benefits, etc.)

-- Provisions Master Table
CREATE TABLE IF NOT EXISTS provisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    provision_code VARCHAR(50) NOT NULL,
    provision_name VARCHAR(255) NOT NULL,
    provision_type VARCHAR(50) NOT NULL CHECK (provision_type IN (
        'bad_debts',
        'warranty',
        'gratuity',
        'leave_encashment',
        'employee_benefits',
        'litigation',
        'others'
    )),
    provision_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT, -- Liability account
    expense_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT, -- P&L expense account
    calculation_method VARCHAR(50), -- 'percentage', 'fixed', 'aging', 'custom'
    calculation_rate DECIMAL(10,4), -- Percentage or fixed amount
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, provision_code)
);

-- Provision Entries (Additions, Reversals, Utilization)
CREATE TABLE IF NOT EXISTS provision_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    provision_id UUID REFERENCES provisions(id) ON DELETE CASCADE,
    financial_year VARCHAR(9) NOT NULL, -- '2024-2025'
    entry_date DATE NOT NULL,
    entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('addition', 'reversal', 'utilization')),
    amount DECIMAL(15,2) NOT NULL,
    opening_balance DECIMAL(15,2) DEFAULT 0,
    closing_balance DECIMAL(15,2) DEFAULT 0,
    reference_type VARCHAR(50), -- 'invoice', 'purchase', 'employee', 'custom'
    reference_id UUID,
    narration TEXT,
    journal_entry_id UUID, -- Reference to ledger entry if posted
    is_posted BOOLEAN DEFAULT false,
    posted_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- Provision Calculations (for automatic calculations)
CREATE TABLE IF NOT EXISTS provision_calculations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    provision_id UUID REFERENCES provisions(id) ON DELETE CASCADE,
    financial_year VARCHAR(9) NOT NULL,
    calculation_date DATE NOT NULL,
    base_amount DECIMAL(15,2), -- Base amount for percentage calculation
    calculation_rate DECIMAL(10,4),
    calculated_amount DECIMAL(15,2) NOT NULL,
    actual_amount DECIMAL(15,2), -- Actual provision created (may differ from calculated)
    calculation_details JSONB, -- Store calculation parameters
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_provisions_business_id ON provisions(business_id);
CREATE INDEX IF NOT EXISTS idx_provisions_type ON provisions(provision_type);
CREATE INDEX IF NOT EXISTS idx_provision_entries_provision_id ON provision_entries(provision_id);
CREATE INDEX IF NOT EXISTS idx_provision_entries_financial_year ON provision_entries(financial_year);
CREATE INDEX IF NOT EXISTS idx_provision_entries_entry_date ON provision_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_provision_calculations_provision_id ON provision_calculations(provision_id);
CREATE INDEX IF NOT EXISTS idx_provision_calculations_financial_year ON provision_calculations(financial_year);

-- Comments
COMMENT ON TABLE provisions IS 'Master table for different types of provisions';
COMMENT ON TABLE provision_entries IS 'Individual provision entries (additions, reversals, utilization)';
COMMENT ON TABLE provision_calculations IS 'Stores automatic calculation details for provisions';

