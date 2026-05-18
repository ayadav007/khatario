-- Migration 067: Financial Year Closing
-- Creates tables for financial year management and year closing process

-- Financial Years
CREATE TABLE IF NOT EXISTS financial_years (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    year_code VARCHAR(9) NOT NULL, -- '2024-2025'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_closed BOOLEAN DEFAULT false,
    closed_at TIMESTAMP,
    closed_by UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, year_code)
);

-- Year Closing Entries (Journal entries created during year closing)
CREATE TABLE IF NOT EXISTS year_closing_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    financial_year_id UUID REFERENCES financial_years(id) ON DELETE CASCADE,
    entry_type VARCHAR(50) NOT NULL, -- 'profit_transfer', 'opening_balance'
    account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    debit DECIMAL(15,2) DEFAULT 0,
    credit DECIMAL(15,2) DEFAULT 0,
    narration TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Opening Balances (Opening balances for new financial year)
CREATE TABLE IF NOT EXISTS opening_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    financial_year_id UUID REFERENCES financial_years(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    opening_balance DECIMAL(15,2) NOT NULL,
    opening_balance_type VARCHAR(10) NOT NULL CHECK (opening_balance_type IN ('debit', 'credit')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, financial_year_id, account_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_financial_years_business_id ON financial_years(business_id);
CREATE INDEX IF NOT EXISTS idx_year_closing_entries_fy_id ON year_closing_entries(financial_year_id);
CREATE INDEX IF NOT EXISTS idx_opening_balances_fy_id ON opening_balances(financial_year_id);
CREATE INDEX IF NOT EXISTS idx_opening_balances_account_id ON opening_balances(account_id);

COMMENT ON TABLE financial_years IS 'Financial year definitions';
COMMENT ON TABLE year_closing_entries IS 'Journal entries created during year closing process';
COMMENT ON TABLE opening_balances IS 'Opening balances for each financial year';

