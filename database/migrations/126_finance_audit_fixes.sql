-- Migration 126: Finance Audit Fixes
-- Implements critical accounting fixes identified in finance audit

-- Step 1: Add COGS account to chart of accounts
-- This adds Cost of Goods Sold account (5104) to the default chart
DO $$
DECLARE
  v_business_id UUID;
  v_purchases_group_id UUID;
BEGIN
  -- For each business, add COGS account
  FOR v_business_id IN SELECT id FROM businesses LOOP
    -- Get Direct Expenses group (5100)
    SELECT id INTO v_purchases_group_id
    FROM account_groups
    WHERE business_id = v_business_id AND group_code = '5100'
    LIMIT 1;
    
    -- Add COGS account if group exists and account doesn't exist
    IF v_purchases_group_id IS NOT NULL THEN
      INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
      SELECT 
        v_business_id,
        '5104',
        'Cost of Goods Sold',
        'expense',
        v_purchases_group_id,
        'debit',
        true,
        4
      WHERE NOT EXISTS (
        SELECT 1 FROM accounts 
        WHERE business_id = v_business_id AND account_code = '5104'
      );
    END IF;
  END LOOP;
END $$;

-- Step 2: Create Inter-Branch Transactions account group (6000) for elimination
DO $$
DECLARE
  v_business_id UUID;
  v_elimination_group_id UUID;
BEGIN
  -- For each business, create elimination group
  FOR v_business_id IN SELECT id FROM businesses LOOP
    -- Create Inter-Branch Transactions group (6000)
    INSERT INTO account_groups (business_id, group_code, group_name, group_type, is_system, sort_order)
    SELECT 
      v_business_id,
      '6000',
      'Inter-Branch Transactions (Elimination)',
      'elimination',
      true,
      6
    WHERE NOT EXISTS (
      SELECT 1 FROM account_groups 
      WHERE business_id = v_business_id AND group_code = '6000'
    )
    RETURNING id INTO v_elimination_group_id;
    
    -- Get the group ID if it already exists
    IF v_elimination_group_id IS NULL THEN
      SELECT id INTO v_elimination_group_id
      FROM account_groups
      WHERE business_id = v_business_id AND group_code = '6000'
      LIMIT 1;
    END IF;
    
    -- Reclassify inter-branch accounts to elimination group
    IF v_elimination_group_id IS NOT NULL THEN
      UPDATE accounts
      SET account_group_id = v_elimination_group_id
      WHERE business_id = v_business_id
        AND account_code IN ('1109', '2111', '4103', '5103')
        AND account_group_id != v_elimination_group_id;
    END IF;
  END LOOP;
END $$;

-- Step 3: Add is_elimination_account flag to accounts table (if not exists in schema)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'accounts' AND column_name = 'is_elimination_account'
  ) THEN
    ALTER TABLE accounts
      ADD COLUMN is_elimination_account BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Mark inter-branch accounts as elimination accounts
UPDATE accounts
SET is_elimination_account = true
WHERE account_code IN ('1109', '2111', '4103', '5103');

-- Step 4: Create ledger_entry_history table for audit trail
CREATE TABLE IF NOT EXISTS ledger_entry_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ledger_entry_line_id UUID NOT NULL REFERENCES ledger_entry_lines(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL, -- 'created', 'reversed', 'period_locked'
  action_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  action_by UUID REFERENCES users(id) ON DELETE SET NULL,
  old_value JSONB, -- Previous values (for reversals)
  new_value JSONB, -- New values
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ledger_entry_history_entry_id ON ledger_entry_history(ledger_entry_line_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_history_action_date ON ledger_entry_history(action_date DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_history_action_by ON ledger_entry_history(action_by);

-- Step 5: Create trigger to log ledger entry creation
CREATE OR REPLACE FUNCTION log_ledger_entry_creation()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ledger_entry_history (
    ledger_entry_line_id,
    action,
    action_by,
    new_value
  )
  VALUES (
    NEW.id,
    'created',
    NULL, -- Will be set by application
    jsonb_build_object(
      'voucher_id', NEW.voucher_id,
      'voucher_type', NEW.voucher_type,
      'account_id', NEW.account_id,
      'entry_date', NEW.entry_date,
      'debit', NEW.debit,
      'credit', NEW.credit,
      'branch_id', NEW.branch_id
    )
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_ledger_entry_creation_trigger ON ledger_entry_lines;
CREATE TRIGGER log_ledger_entry_creation_trigger
  AFTER INSERT ON ledger_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION log_ledger_entry_creation();

-- Step 6: Add backdate_reason column to invoices, purchases, expenses
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS backdate_reason TEXT;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS backdate_reason TEXT;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS backdate_reason TEXT;

-- Add comments
COMMENT ON COLUMN accounts.is_elimination_account IS 'Accounts that should be eliminated in consolidated financial statements (e.g., inter-branch transactions)';
COMMENT ON COLUMN invoices.backdate_reason IS 'Reason for backdating invoice (required for entries > 30 days old)';
COMMENT ON COLUMN purchases.backdate_reason IS 'Reason for backdating purchase (required for entries > 30 days old)';
COMMENT ON COLUMN expenses.backdate_reason IS 'Reason for backdating expense (required for entries > 30 days old)';
COMMENT ON TABLE ledger_entry_history IS 'Audit trail for ledger entry changes, reversals, and period lock events';

-- Step 7: Add validation to prevent locking future periods
CREATE OR REPLACE FUNCTION validate_period_lock_dates()
RETURNS TRIGGER AS $$
BEGIN
  -- Only allow locking periods that are in the past
  IF NEW.period_end > CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot lock future periods. Period end date: %', NEW.period_end;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_period_lock_dates_trigger ON period_locks;
CREATE TRIGGER validate_period_lock_dates_trigger
  BEFORE INSERT OR UPDATE ON period_locks
  FOR EACH ROW
  WHEN (NEW.is_locked = true)
  EXECUTE FUNCTION validate_period_lock_dates();

COMMENT ON FUNCTION validate_period_lock_dates IS 'Prevents locking future periods. Only past periods can be locked.';
