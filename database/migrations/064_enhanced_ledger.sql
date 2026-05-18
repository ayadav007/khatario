-- Migration 064: Enhanced Ledger System
-- Enhances ledger_entries table and creates ledger_entry_lines for proper double-entry

-- Add new columns to ledger_entries if they don't exist
DO $$ 
BEGIN
    -- Add account_id if it doesn't exist (from previous migration)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ledger_entries' AND column_name = 'account_id'
    ) THEN
        ALTER TABLE ledger_entries ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT;
        CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_id ON ledger_entries(account_id);
    END IF;

    -- Add voucher_number
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ledger_entries' AND column_name = 'voucher_number'
    ) THEN
        ALTER TABLE ledger_entries ADD COLUMN voucher_number VARCHAR(100);
        CREATE INDEX IF NOT EXISTS idx_ledger_entries_voucher_number ON ledger_entries(business_id, voucher_number);
    END IF;

    -- Add voucher_type
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ledger_entries' AND column_name = 'voucher_type'
    ) THEN
        ALTER TABLE ledger_entries ADD COLUMN voucher_type VARCHAR(50); -- 'invoice', 'payment', 'purchase', 'expense', 'journal', 'opening_balance'
    END IF;

    -- Add reference_number
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ledger_entries' AND column_name = 'reference_number'
    ) THEN
        ALTER TABLE ledger_entries ADD COLUMN reference_number VARCHAR(100);
    END IF;

    -- Add is_opening_balance
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ledger_entries' AND column_name = 'is_opening_balance'
    ) THEN
        ALTER TABLE ledger_entries ADD COLUMN is_opening_balance BOOLEAN DEFAULT false;
    END IF;

    -- Add financial_year
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ledger_entries' AND column_name = 'financial_year'
    ) THEN
        ALTER TABLE ledger_entries ADD COLUMN financial_year VARCHAR(9); -- Format: '2024-2025'
    END IF;
END $$;

-- Create ledger_entry_lines table for proper double-entry journal entries
CREATE TABLE IF NOT EXISTS ledger_entry_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    voucher_id UUID, -- Reference to journal entry or transaction
    voucher_type VARCHAR(50) NOT NULL, -- 'journal', 'invoice', 'payment', etc.
    account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    entry_date DATE NOT NULL,
    debit DECIMAL(15,2) DEFAULT 0,
    credit DECIMAL(15,2) DEFAULT 0,
    narration TEXT,
    reference_number VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Ensure either debit or credit is set, but not both
    CONSTRAINT check_debit_credit CHECK (
        (debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)
    )
);

-- Indexes for ledger_entry_lines
CREATE INDEX IF NOT EXISTS idx_ledger_entry_lines_business_id ON ledger_entry_lines(business_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_lines_account_id ON ledger_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_lines_voucher ON ledger_entry_lines(voucher_id, voucher_type);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_lines_date ON ledger_entry_lines(entry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_lines_financial_year ON ledger_entries(business_id, financial_year);

-- Function to generate voucher number
CREATE OR REPLACE FUNCTION generate_voucher_number(
    p_business_id UUID,
    p_voucher_type VARCHAR(50),
    p_entry_date DATE
)
RETURNS VARCHAR(100) AS $$
DECLARE
    v_prefix VARCHAR(10);
    v_year VARCHAR(4);
    v_sequence INTEGER;
    v_voucher_number VARCHAR(100);
BEGIN
    -- Set prefix based on voucher type
    v_prefix := CASE p_voucher_type
        WHEN 'invoice' THEN 'INV'
        WHEN 'payment' THEN 'PAY'
        WHEN 'purchase' THEN 'PUR'
        WHEN 'expense' THEN 'EXP'
        WHEN 'journal' THEN 'JRN'
        WHEN 'opening_balance' THEN 'OB'
        ELSE 'VCH'
    END;

    v_year := TO_CHAR(p_entry_date, 'YYYY');

    -- Get next sequence number for this type and year
    SELECT COALESCE(MAX(CAST(SUBSTRING(voucher_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO v_sequence
    FROM ledger_entries
    WHERE business_id = p_business_id
      AND voucher_type = p_voucher_type
      AND voucher_number LIKE v_prefix || '/' || v_year || '/%';

    v_voucher_number := v_prefix || '/' || v_year || '/' || LPAD(v_sequence::TEXT, 6, '0');

    RETURN v_voucher_number;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate account balance as of date
CREATE OR REPLACE FUNCTION get_account_balance(
    p_account_id UUID,
    p_business_id UUID,
    p_as_on_date DATE DEFAULT NULL
)
RETURNS DECIMAL(15,2) AS $$
DECLARE
    v_opening_balance DECIMAL(15,2);
    v_opening_type VARCHAR(10);
    v_account_nature VARCHAR(10);
    v_debit_total DECIMAL(15,2);
    v_credit_total DECIMAL(15,2);
    v_balance DECIMAL(15,2);
BEGIN
    -- Get account opening balance and nature
    SELECT opening_balance, opening_balance_type, nature
    INTO v_opening_balance, v_opening_type, v_account_nature
    FROM accounts
    WHERE id = p_account_id AND business_id = p_business_id;

    IF v_opening_balance IS NULL THEN
        RETURN 0;
    END IF;

    -- Calculate opening balance based on nature
    IF v_account_nature = 'debit' THEN
        IF v_opening_type = 'debit' THEN
            v_balance := v_opening_balance;
        ELSE
            v_balance := -v_opening_balance;
        END IF;
    ELSE
        IF v_opening_type = 'credit' THEN
            v_balance := -v_opening_balance;
        ELSE
            v_balance := v_opening_balance;
        END IF;
    END IF;

    -- Calculate transaction totals
    IF p_as_on_date IS NULL THEN
        SELECT 
            COALESCE(SUM(debit), 0),
            COALESCE(SUM(credit), 0)
        INTO v_debit_total, v_credit_total
        FROM ledger_entry_lines
        WHERE account_id = p_account_id AND business_id = p_business_id;
    ELSE
        SELECT 
            COALESCE(SUM(debit), 0),
            COALESCE(SUM(credit), 0)
        INTO v_debit_total, v_credit_total
        FROM ledger_entry_lines
        WHERE account_id = p_account_id 
          AND business_id = p_business_id
          AND entry_date <= p_as_on_date;
    END IF;

    -- Calculate final balance based on account nature
    IF v_account_nature = 'debit' THEN
        v_balance := v_balance + v_debit_total - v_credit_total;
    ELSE
        v_balance := v_balance + v_credit_total - v_debit_total;
    END IF;

    RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE ledger_entry_lines IS 'Individual lines of ledger entries for proper double-entry bookkeeping';
COMMENT ON FUNCTION generate_voucher_number IS 'Generates unique voucher numbers for transactions';
COMMENT ON FUNCTION get_account_balance IS 'Calculates account balance as of a specific date';

