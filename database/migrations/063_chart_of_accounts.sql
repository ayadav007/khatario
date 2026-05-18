-- Migration 063: Chart of Accounts System
-- Creates account groups and accounts tables for proper accounting structure

-- Account Groups (Top-level categories)
CREATE TABLE IF NOT EXISTS account_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    group_code VARCHAR(20) NOT NULL, -- '1000', '2000', '3000', etc.
    group_name VARCHAR(255) NOT NULL, -- 'Assets', 'Liabilities', 'Income', 'Expenses', 'Capital'
    group_type VARCHAR(50) NOT NULL, -- 'asset', 'liability', 'income', 'expense', 'capital'
    parent_group_id UUID REFERENCES account_groups(id) ON DELETE SET NULL, -- For sub-groups
    is_system BOOLEAN DEFAULT false, -- System groups cannot be deleted
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, group_code)
);

-- Accounts (Individual ledger accounts)
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    account_code VARCHAR(50) NOT NULL, -- Hierarchical: '1001', '1002', '2001', etc.
    account_name VARCHAR(255) NOT NULL,
    account_type VARCHAR(50) NOT NULL, -- 'asset', 'liability', 'income', 'expense', 'capital'
    account_group_id UUID REFERENCES account_groups(id) ON DELETE RESTRICT,
    parent_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL, -- For sub-accounts
    nature VARCHAR(10) NOT NULL CHECK (nature IN ('debit', 'credit')), -- Debit nature (Assets, Expenses) or Credit nature (Liabilities, Income, Capital)
    opening_balance DECIMAL(15,2) DEFAULT 0,
    opening_balance_type VARCHAR(10) DEFAULT 'debit' CHECK (opening_balance_type IN ('debit', 'credit')),
    is_active BOOLEAN DEFAULT true,
    is_system BOOLEAN DEFAULT false, -- System accounts cannot be deleted
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, account_code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_account_groups_business_id ON account_groups(business_id);
CREATE INDEX IF NOT EXISTS idx_account_groups_type ON account_groups(group_type);
CREATE INDEX IF NOT EXISTS idx_account_groups_parent ON account_groups(parent_group_id);

CREATE INDEX IF NOT EXISTS idx_accounts_business_id ON accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_accounts_group_id ON accounts(account_group_id);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_code ON accounts(business_id, account_code);

-- Update ledger_entries to reference accounts
-- Add account_id column if it doesn't exist (for backward compatibility)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ledger_entries' AND column_name = 'account_id'
    ) THEN
        ALTER TABLE ledger_entries ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT;
        CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_id ON ledger_entries(account_id);
    END IF;
END $$;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_account_groups_updated_at
    BEFORE UPDATE ON account_groups
    FOR EACH ROW
    EXECUTE FUNCTION update_accounts_updated_at();

CREATE TRIGGER update_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_accounts_updated_at();

COMMENT ON TABLE account_groups IS 'Top-level account groups for organizing accounts (Assets, Liabilities, Income, Expenses, Capital)';
COMMENT ON TABLE accounts IS 'Individual ledger accounts with hierarchical structure';
COMMENT ON COLUMN accounts.nature IS 'Debit nature (Assets, Expenses) or Credit nature (Liabilities, Income, Capital)';

