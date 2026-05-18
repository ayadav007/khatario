-- Migration 123: Ledger Immutability and Period Locks
-- Adds immutability constraints to ledger entries and implements period locks

-- Step 1: Add immutability columns to ledger_entry_lines
ALTER TABLE ledger_entry_lines
  ADD COLUMN IF NOT EXISTS is_editable BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

-- Step 2: Create trigger function to prevent updates when not editable
CREATE OR REPLACE FUNCTION prevent_ledger_entry_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow updates only if entry is marked as editable
  IF OLD.is_editable = false THEN
    RAISE EXCEPTION 'Ledger entry is immutable. Entry ID: %. Use reversal entries instead of direct edits.', OLD.id;
  END IF;
  
  -- Update timestamp on allowed updates
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Create trigger to enforce immutability
DROP TRIGGER IF EXISTS prevent_ledger_entry_update_trigger ON ledger_entry_lines;
CREATE TRIGGER prevent_ledger_entry_update_trigger
  BEFORE UPDATE ON ledger_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION prevent_ledger_entry_update();

-- Step 4: Create period_locks table
CREATE TABLE IF NOT EXISTS period_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  financial_year VARCHAR(9) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  is_locked BOOLEAN DEFAULT true,
  locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  locked_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, branch_id, financial_year, period_start, period_end)
);

-- Step 5: Create indexes for period_locks
CREATE INDEX IF NOT EXISTS idx_period_locks_business ON period_locks(business_id, branch_id, financial_year);
CREATE INDEX IF NOT EXISTS idx_period_locks_dates ON period_locks(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_period_locks_locked ON period_locks(business_id, is_locked);

-- Step 6: Create function to check if period is locked
CREATE OR REPLACE FUNCTION is_period_locked(
  p_business_id UUID,
  p_branch_id UUID,
  p_entry_date DATE
)
RETURNS BOOLEAN AS $$
DECLARE
  v_locked BOOLEAN := false;
BEGIN
  -- Check for branch-specific lock
  SELECT EXISTS(
    SELECT 1 FROM period_locks
    WHERE business_id = p_business_id
      AND branch_id = p_branch_id
      AND p_entry_date BETWEEN period_start AND period_end
      AND is_locked = true
  ) INTO v_locked;
  
  -- If no branch-specific lock, check for business-wide lock
  IF NOT v_locked THEN
    SELECT EXISTS(
      SELECT 1 FROM period_locks
      WHERE business_id = p_business_id
        AND branch_id IS NULL
        AND p_entry_date BETWEEN period_start AND period_end
        AND is_locked = true
    ) INTO v_locked;
  END IF;
  
  RETURN v_locked;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Create trigger function to validate period locks on ledger entry creation
CREATE OR REPLACE FUNCTION validate_period_lock()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if period is locked
  IF is_period_locked(NEW.business_id, NEW.branch_id, NEW.entry_date) THEN
    RAISE EXCEPTION 'Cannot create ledger entry in locked period. Entry date: %, Business: %, Branch: %', 
      NEW.entry_date, NEW.business_id, NEW.branch_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 8: Create trigger to validate period locks
DROP TRIGGER IF EXISTS validate_period_lock_trigger ON ledger_entry_lines;
CREATE TRIGGER validate_period_lock_trigger
  BEFORE INSERT ON ledger_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION validate_period_lock();

-- Step 9: Create function to validate voucher-level balance
CREATE OR REPLACE FUNCTION validate_voucher_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_total_debit DECIMAL(15,2);
  v_total_credit DECIMAL(15,2);
  v_difference DECIMAL(15,2);
BEGIN
  -- Calculate totals for this voucher after the insert
  SELECT 
    COALESCE(SUM(debit), 0),
    COALESCE(SUM(credit), 0)
  INTO v_total_debit, v_total_credit
  FROM ledger_entry_lines
  WHERE voucher_id = NEW.voucher_id 
    AND voucher_type = NEW.voucher_type
    AND business_id = NEW.business_id;
  
  v_difference := ABS(v_total_debit - v_total_credit);
  
  -- Allow small rounding differences (0.01)
  IF v_difference > 0.01 THEN
    RAISE EXCEPTION 'Voucher is not balanced. Voucher ID: %, Type: %, Debit: %, Credit: %, Difference: %', 
      NEW.voucher_id, NEW.voucher_type, v_total_debit, v_total_credit, v_difference;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 10: Create trigger to validate voucher balance (deferred to end of transaction)
DROP TRIGGER IF EXISTS validate_voucher_balance_trigger ON ledger_entry_lines;
CREATE CONSTRAINT TRIGGER validate_voucher_balance_trigger
  AFTER INSERT ON ledger_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION validate_voucher_balance();

-- Step 11: Add update trigger for updated_at
DROP TRIGGER IF EXISTS update_period_locks_updated_at ON period_locks;
CREATE TRIGGER update_period_locks_updated_at BEFORE UPDATE ON period_locks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Step 12: Add comments
COMMENT ON TABLE period_locks IS 'Period locks prevent ledger entries in closed accounting periods';
COMMENT ON COLUMN period_locks.branch_id IS 'NULL for business-wide lock, specific branch_id for branch-specific lock';
COMMENT ON COLUMN period_locks.is_locked IS 'true = period is locked, false = period is unlocked';
COMMENT ON COLUMN ledger_entry_lines.is_editable IS 'true = entry can be edited, false = entry is immutable (default)';
COMMENT ON FUNCTION is_period_locked IS 'Checks if a period is locked for a given business and branch';
COMMENT ON FUNCTION validate_voucher_balance IS 'Validates that voucher debits equal credits (with 0.01 tolerance)';
