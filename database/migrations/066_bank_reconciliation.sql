-- Migration 066: Bank Reconciliation
-- Creates tables for bank account management and statement reconciliation

-- Bank Accounts
CREATE TABLE IF NOT EXISTS bank_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    account_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(100) NOT NULL,
    bank_name VARCHAR(255) NOT NULL,
    ifsc_code VARCHAR(20),
    branch_name VARCHAR(255),
    account_type VARCHAR(50), -- 'savings', 'current', 'cc', 'od'
    ledger_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT, -- Link to Chart of Accounts
    is_active BOOLEAN DEFAULT true,
    opening_balance DECIMAL(15,2) DEFAULT 0,
    opening_balance_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, account_number)
);

-- Bank Statements (Imported statement files)
CREATE TABLE IF NOT EXISTS bank_statements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE CASCADE,
    statement_period_start DATE NOT NULL,
    statement_period_end DATE NOT NULL,
    opening_balance DECIMAL(15,2) NOT NULL,
    closing_balance DECIMAL(15,2) NOT NULL,
    file_name VARCHAR(255),
    file_url TEXT,
    import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    imported_by UUID REFERENCES users(id),
    is_reconciled BOOLEAN DEFAULT false,
    reconciled_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bank Statement Lines (Individual transactions from statement)
CREATE TABLE IF NOT EXISTS bank_statement_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    bank_statement_id UUID REFERENCES bank_statements(id) ON DELETE CASCADE,
    transaction_date DATE NOT NULL,
    value_date DATE,
    description TEXT NOT NULL,
    cheque_number VARCHAR(50),
    debit_amount DECIMAL(15,2) DEFAULT 0,
    credit_amount DECIMAL(15,2) DEFAULT 0,
    balance DECIMAL(15,2) NOT NULL,
    reference_number VARCHAR(100),
    is_matched BOOLEAN DEFAULT false,
    matched_ledger_entry_id UUID, -- Reference to ledger_entry_lines
    matched_payment_id UUID, -- Reference to payments table
    match_type VARCHAR(50), -- 'exact', 'partial', 'manual'
    matched_at TIMESTAMP,
    matched_by UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bank Reconciliation (Summary of reconciliation)
CREATE TABLE IF NOT EXISTS bank_reconciliation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE CASCADE,
    reconciliation_date DATE NOT NULL,
    statement_balance DECIMAL(15,2) NOT NULL,
    ledger_balance DECIMAL(15,2) NOT NULL,
    difference DECIMAL(15,2) NOT NULL,
    outstanding_cheques DECIMAL(15,2) DEFAULT 0,
    deposits_in_transit DECIMAL(15,2) DEFAULT 0,
    bank_charges DECIMAL(15,2) DEFAULT 0,
    interest_earned DECIMAL(15,2) DEFAULT 0,
    other_adjustments DECIMAL(15,2) DEFAULT 0,
    adjusted_balance DECIMAL(15,2) NOT NULL,
    is_reconciled BOOLEAN DEFAULT false,
    reconciled_by UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bank_accounts_business_id ON bank_accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_ledger_account ON bank_accounts(ledger_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_statements_bank_account_id ON bank_statements(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_statement_id ON bank_statement_lines(bank_statement_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_matched ON bank_statement_lines(is_matched);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_bank_account_id ON bank_reconciliation(bank_account_id);

COMMENT ON TABLE bank_accounts IS 'Business bank accounts';
COMMENT ON TABLE bank_statements IS 'Imported bank statements';
COMMENT ON TABLE bank_statement_lines IS 'Individual transactions from bank statements';
COMMENT ON TABLE bank_reconciliation IS 'Bank reconciliation summaries';

