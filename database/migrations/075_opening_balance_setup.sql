-- Migration 075: Opening Balance Transactions Table
-- Creates table for tracking opening balance setup transactions

CREATE TABLE IF NOT EXISTS opening_balance_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    financial_year_id UUID REFERENCES financial_years(id) ON DELETE SET NULL,
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('account', 'customer', 'supplier')),
    entity_id UUID NOT NULL,
    opening_balance DECIMAL(15,2) NOT NULL,
    opening_balance_type VARCHAR(10) NOT NULL CHECK (opening_balance_type IN ('debit', 'credit')),
    as_on_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    
    UNIQUE(business_id, entity_type, entity_id, financial_year_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_opening_balance_transactions_business_id ON opening_balance_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_opening_balance_transactions_financial_year_id ON opening_balance_transactions(financial_year_id);
CREATE INDEX IF NOT EXISTS idx_opening_balance_transactions_entity ON opening_balance_transactions(entity_type, entity_id);

COMMENT ON TABLE opening_balance_transactions IS 'Tracks opening balance setup transactions for accounts, customers, and suppliers';
COMMENT ON COLUMN opening_balance_transactions.entity_type IS 'Type of entity: account, customer, or supplier';
COMMENT ON COLUMN opening_balance_transactions.entity_id IS 'ID of the account, customer, or supplier';
COMMENT ON COLUMN opening_balance_transactions.as_on_date IS 'Date as of which the opening balance is set';

