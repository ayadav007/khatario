-- Migration 121: Add branch_id to all transaction tables
-- This enables proper branch-level accounting and compliance

-- Step 1: Add branch_id to invoices
ALTER TABLE invoices 
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT;

-- Step 2: Add branch_id to purchases
ALTER TABLE purchases 
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT;

-- Step 3: Add branch_id to credit_notes
ALTER TABLE credit_notes 
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT;

-- Step 4: Add branch_id to payments
ALTER TABLE payments 
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT;

-- Step 5: Add branch_id to expenses
ALTER TABLE expenses 
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT;

-- Step 6: Add branch_id to purchase_returns (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchase_returns') THEN
    ALTER TABLE purchase_returns 
      ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Step 7: Add branch_id to debit_notes (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'debit_notes') THEN
    ALTER TABLE debit_notes 
      ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Step 8: Add branch_id to ledger_entry_lines
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ledger_entry_lines') THEN
    ALTER TABLE ledger_entry_lines 
      ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Step 9: Add branch_id to journal_entries (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entries') THEN
    ALTER TABLE journal_entries 
      ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Step 10: Migrate existing transactions to primary branch
-- For existing invoices/purchases, assign to primary branch of business
UPDATE invoices i
SET branch_id = (
  SELECT b.id 
  FROM branches b 
  WHERE b.business_id = i.business_id 
    AND b.is_primary = true 
  LIMIT 1
)
WHERE i.branch_id IS NULL;

UPDATE purchases p
SET branch_id = (
  SELECT b.id 
  FROM branches b 
  WHERE b.business_id = p.business_id 
    AND b.is_primary = true 
  LIMIT 1
)
WHERE p.branch_id IS NULL;

UPDATE credit_notes cn
SET branch_id = (
  SELECT b.id 
  FROM branches b 
  WHERE b.business_id = cn.business_id 
    AND b.is_primary = true 
  LIMIT 1
)
WHERE cn.branch_id IS NULL;

UPDATE payments py
SET branch_id = (
  SELECT b.id 
  FROM branches b 
  WHERE b.business_id = py.business_id 
    AND b.is_primary = true 
  LIMIT 1
)
WHERE py.branch_id IS NULL;

UPDATE expenses e
SET branch_id = (
  SELECT b.id 
  FROM branches b 
  WHERE b.business_id = e.business_id 
    AND b.is_primary = true 
  LIMIT 1
)
WHERE e.branch_id IS NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_invoices_branch_id ON invoices(branch_id);
CREATE INDEX IF NOT EXISTS idx_purchases_branch_id ON purchases(branch_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_branch_id ON credit_notes(branch_id);
CREATE INDEX IF NOT EXISTS idx_payments_branch_id ON payments(branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_branch_id ON expenses(branch_id);

-- Add comments
COMMENT ON COLUMN invoices.branch_id IS 'Branch (accounting entity) that issued this invoice. MANDATORY for multi-branch businesses.';
COMMENT ON COLUMN purchases.branch_id IS 'Branch (accounting entity) that made this purchase. MANDATORY for multi-branch businesses.';
COMMENT ON COLUMN credit_notes.branch_id IS 'Branch (accounting entity) that issued this credit note. MANDATORY for multi-branch businesses.';
COMMENT ON COLUMN payments.branch_id IS 'Branch (accounting entity) that processed this payment. MANDATORY for multi-branch businesses.';
COMMENT ON COLUMN expenses.branch_id IS 'Branch (accounting entity) that incurred this expense. MANDATORY for multi-branch businesses.';
