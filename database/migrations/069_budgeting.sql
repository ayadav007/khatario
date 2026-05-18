-- Migration 069: Budgeting & Forecasting
-- Creates tables for budget management and variance analysis

-- Budgets
CREATE TABLE IF NOT EXISTS budgets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    budget_name VARCHAR(255) NOT NULL,
    budget_type VARCHAR(20) NOT NULL CHECK (budget_type IN ('monthly', 'quarterly', 'yearly')),
    financial_year VARCHAR(9) NOT NULL,
    period_start_date DATE NOT NULL,
    period_end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, budget_name, financial_year)
);

-- Budget Lines (Account-wise budget amounts)
CREATE TABLE IF NOT EXISTS budget_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    budget_id UUID REFERENCES budgets(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    budget_amount DECIMAL(15,2) NOT NULL,
    period_month INTEGER, -- 1-12 for monthly budgets
    period_quarter VARCHAR(2), -- 'Q1', 'Q2', 'Q3', 'Q4' for quarterly budgets
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(budget_id, account_id, period_month, period_quarter)
);

-- Budget Variance (Actual vs Budget comparison - calculated on demand)
-- This is a view or calculated at runtime, not a table

-- Indexes
CREATE INDEX IF NOT EXISTS idx_budgets_business_id ON budgets(business_id);
CREATE INDEX IF NOT EXISTS idx_budgets_fy ON budgets(financial_year);
CREATE INDEX IF NOT EXISTS idx_budget_lines_budget_id ON budget_lines(budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_lines_account_id ON budget_lines(account_id);

COMMENT ON TABLE budgets IS 'Budget definitions for different periods';
COMMENT ON TABLE budget_lines IS 'Account-wise budget amounts';

