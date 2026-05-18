-- Migration 125: Branch & Warehouse Integrity Fixes
-- Implements critical database constraints and fixes identified in audit

-- Step 1: Add NOT NULL constraints to branch_id columns (after ensuring all rows have values)
-- First, ensure all existing rows have branch_id
-- Use is_default (from migration 128) or fallback to is_primary (older schema) or first branch

-- Helper: Update invoices
UPDATE invoices SET branch_id = (
  SELECT id FROM branches 
  WHERE business_id = invoices.business_id 
    AND (
      is_default = true 
      OR (is_default IS NULL AND is_primary = true)
      OR (is_default IS NULL AND is_primary IS NULL AND id = (
        SELECT id FROM branches WHERE business_id = invoices.business_id AND is_active = true LIMIT 1
      ))
    )
  LIMIT 1
) WHERE branch_id IS NULL;

-- Helper: Update purchases
UPDATE purchases SET branch_id = (
  SELECT id FROM branches 
  WHERE business_id = purchases.business_id 
    AND (
      is_default = true 
      OR (is_default IS NULL AND is_primary = true)
      OR (is_default IS NULL AND is_primary IS NULL AND id = (
        SELECT id FROM branches WHERE business_id = purchases.business_id AND is_active = true LIMIT 1
      ))
    )
  LIMIT 1
) WHERE branch_id IS NULL;

-- Helper: Update credit_notes
UPDATE credit_notes SET branch_id = (
  SELECT id FROM branches 
  WHERE business_id = credit_notes.business_id 
    AND (
      is_default = true 
      OR (is_default IS NULL AND is_primary = true)
      OR (is_default IS NULL AND is_primary IS NULL AND id = (
        SELECT id FROM branches WHERE business_id = credit_notes.business_id AND is_active = true LIMIT 1
      ))
    )
  LIMIT 1
) WHERE branch_id IS NULL;

-- Helper: Update payments
UPDATE payments SET branch_id = (
  SELECT id FROM branches 
  WHERE business_id = payments.business_id 
    AND (
      is_default = true 
      OR (is_default IS NULL AND is_primary = true)
      OR (is_default IS NULL AND is_primary IS NULL AND id = (
        SELECT id FROM branches WHERE business_id = payments.business_id AND is_active = true LIMIT 1
      ))
    )
  LIMIT 1
) WHERE branch_id IS NULL;

-- Helper: Update expenses
UPDATE expenses SET branch_id = (
  SELECT id FROM branches 
  WHERE business_id = expenses.business_id 
    AND (
      is_default = true 
      OR (is_default IS NULL AND is_primary = true)
      OR (is_default IS NULL AND is_primary IS NULL AND id = (
        SELECT id FROM branches WHERE business_id = expenses.business_id AND is_active = true LIMIT 1
      ))
    )
  LIMIT 1
) WHERE branch_id IS NULL;

-- CRITICAL: For any invoices/purchases/etc that still have NULL branch_id (business has no branches),
-- create a default branch for those businesses first
DO $$
DECLARE
  business_record RECORD;
BEGIN
  FOR business_record IN 
    SELECT DISTINCT business_id FROM invoices WHERE branch_id IS NULL
    UNION
    SELECT DISTINCT business_id FROM purchases WHERE branch_id IS NULL
    UNION
    SELECT DISTINCT business_id FROM credit_notes WHERE branch_id IS NULL
    UNION
    SELECT DISTINCT business_id FROM payments WHERE branch_id IS NULL
    UNION
    SELECT DISTINCT business_id FROM expenses WHERE branch_id IS NULL
  LOOP
    -- Create default branch if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM branches WHERE business_id = business_record.business_id) THEN
      INSERT INTO branches (business_id, name, is_default, is_active)
      VALUES (business_record.business_id, 'Main Branch', true, true);
    END IF;
  END LOOP;
END $$;

-- Now assign remaining NULLs to default branch (or any active branch)
UPDATE invoices SET branch_id = (
  SELECT id FROM branches 
  WHERE business_id = invoices.business_id 
    AND (is_default = true OR (is_default IS NULL AND is_active = true))
  LIMIT 1
) WHERE branch_id IS NULL;

UPDATE purchases SET branch_id = (
  SELECT id FROM branches 
  WHERE business_id = purchases.business_id 
    AND (is_default = true OR (is_default IS NULL AND is_active = true))
  LIMIT 1
) WHERE branch_id IS NULL;

UPDATE credit_notes SET branch_id = (
  SELECT id FROM branches 
  WHERE business_id = credit_notes.business_id 
    AND (is_default = true OR (is_default IS NULL AND is_active = true))
  LIMIT 1
) WHERE branch_id IS NULL;

UPDATE payments SET branch_id = (
  SELECT id FROM branches 
  WHERE business_id = payments.business_id 
    AND (is_default = true OR (is_default IS NULL AND is_active = true))
  LIMIT 1
) WHERE branch_id IS NULL;

UPDATE expenses SET branch_id = (
  SELECT id FROM branches 
  WHERE business_id = expenses.business_id 
    AND (is_default = true OR (is_default IS NULL AND is_active = true))
  LIMIT 1
) WHERE branch_id IS NULL;

-- Step 1.5: Sync branch invoice number counters after assigning invoices to branches
-- This ensures counters are set higher than existing invoice numbers to prevent duplicates
DO $$
DECLARE
  branch_record RECORD;
  max_invoice_num INTEGER;
  extracted_num INTEGER;
BEGIN
  FOR branch_record IN SELECT id FROM branches LOOP
    -- Find the highest invoice number for this branch
    -- Extract trailing numeric digits from invoice_number (handles formats like "INV-001", "INV-1", "001", etc.)
    -- This regex extracts the last sequence of digits from the invoice number
    SELECT COALESCE(MAX(
      CASE 
        -- Extract trailing digits (e.g., "INV-001" -> 1, "INV-123" -> 123, "001" -> 1)
        WHEN invoice_number ~ '\d+$' THEN
          CAST(SUBSTRING(invoice_number FROM '(\d+)$') AS INTEGER)
        ELSE 0
      END
    ), 0) INTO max_invoice_num
    FROM invoices
    WHERE branch_id = branch_record.id;
    
    -- Update branch counter to be higher than the max existing invoice number
    -- This ensures the next generated number won't conflict
    UPDATE branches
    SET next_invoice_number = GREATEST(max_invoice_num + 1, 1)
    WHERE id = branch_record.id;
    
    -- Log for debugging (only if max was found)
    IF max_invoice_num > 0 THEN
      RAISE NOTICE 'Branch %: Found max invoice number %, setting counter to %', branch_record.id, max_invoice_num, max_invoice_num + 1;
    END IF;
  END LOOP;
END $$;

-- Now add NOT NULL constraints
ALTER TABLE invoices
  ALTER COLUMN branch_id SET NOT NULL;

ALTER TABLE purchases
  ALTER COLUMN branch_id SET NOT NULL;

ALTER TABLE credit_notes
  ALTER COLUMN branch_id SET NOT NULL;

ALTER TABLE payments
  ALTER COLUMN branch_id SET NOT NULL;

ALTER TABLE expenses
  ALTER COLUMN branch_id SET NOT NULL;

-- Step 2: Ensure foreign key constraint exists on invoice_items.location_id (warehouse_id)
-- Check if constraint already exists, if not add it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'invoice_items_location_id_fkey' 
    AND table_name = 'invoice_items'
  ) THEN
    ALTER TABLE invoice_items
      ADD CONSTRAINT invoice_items_location_id_fkey 
        FOREIGN KEY (location_id) REFERENCES warehouses(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Step 3: Add unique constraint on branch invoice numbers (replace business-level uniqueness)
-- Drop old business-level unique constraint if it exists
DROP INDEX IF EXISTS idx_invoices_business_invoice_number;

-- Add branch-level unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_branch_invoice_number 
  ON invoices(branch_id, invoice_number);

-- Step 4: Update user_warehouses table for warehouse access control
-- Handle both old schema (can_transfer, can_adjust) and new schema (can_create_transactions)
-- NOTE: Table already exists from migration 117, so we only need to add the new column

-- Add can_create_transactions column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_warehouses' 
    AND column_name = 'can_create_transactions'
  ) THEN
    -- Add new column
    ALTER TABLE user_warehouses ADD COLUMN can_create_transactions BOOLEAN DEFAULT false;
    
    -- Migrate data from old columns if they exist
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'user_warehouses' 
      AND column_name = 'can_transfer'
    ) THEN
      -- Migrate: can_create_transactions = can_transfer OR can_adjust
      UPDATE user_warehouses 
      SET can_create_transactions = COALESCE(can_transfer, false) OR COALESCE(can_adjust, false);
    END IF;
  END IF;
END $$;

-- Note: We keep can_transfer and can_adjust columns for backward compatibility
-- They can be dropped in a future migration if not needed

-- Ensure indexes exist (they may have been created by migration 117 with different names)
CREATE INDEX IF NOT EXISTS idx_user_warehouses_user_id ON user_warehouses(user_id);
CREATE INDEX IF NOT EXISTS idx_user_warehouses_warehouse_id ON user_warehouses(warehouse_id);

-- Add comments
COMMENT ON TABLE user_warehouses IS 'Controls user access to warehouses. Users can be granted access to specific warehouses for inventory management.';
COMMENT ON COLUMN user_warehouses.can_view IS 'User can view warehouse stock and reports';
COMMENT ON COLUMN user_warehouses.can_edit IS 'User can edit warehouse settings and stock levels';
COMMENT ON COLUMN user_warehouses.can_create_transactions IS 'User can create invoices/purchases that affect this warehouse';

-- Step 5: Add trigger to update updated_at on user_warehouses
CREATE OR REPLACE FUNCTION update_user_warehouses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_warehouses_updated_at ON user_warehouses;
CREATE TRIGGER update_user_warehouses_updated_at
  BEFORE UPDATE ON user_warehouses
  FOR EACH ROW
  EXECUTE FUNCTION update_user_warehouses_updated_at();

-- Step 6: Add function to check if warehouse is accessible by branch
CREATE OR REPLACE FUNCTION is_warehouse_accessible_by_branch(
  p_warehouse_id UUID,
  p_branch_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_accessible BOOLEAN := false;
BEGIN
  -- Check if warehouse exists and belongs to same business as branch
  SELECT EXISTS(
    SELECT 1
    FROM warehouses w
    JOIN branches b ON w.business_id = b.business_id
    WHERE w.id = p_warehouse_id
      AND b.id = p_branch_id
      AND (
        -- Warehouse is directly linked to branch via branch_warehouses
        EXISTS (
          SELECT 1 FROM branch_warehouses bw
          WHERE bw.warehouse_id = p_warehouse_id
            AND bw.branch_id = p_branch_id
        )
        OR
        -- Warehouse has branch_id set to this branch (legacy support)
        w.branch_id = p_branch_id
        OR
        -- Warehouse has no branch_id (shared warehouse accessible by all branches in business)
        w.branch_id IS NULL
      )
  ) INTO v_accessible;
  
  RETURN v_accessible;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION is_warehouse_accessible_by_branch IS 'Checks if a warehouse is accessible by a specific branch. Returns true if warehouse is linked to branch via branch_warehouses, has branch_id set to this branch, or is a shared warehouse (branch_id IS NULL).';

-- Step 7: Add function to get default warehouse for a branch
CREATE OR REPLACE FUNCTION get_default_warehouse_for_branch(
  p_branch_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_warehouse_id UUID;
BEGIN
  -- Try to get primary warehouse for branch
  SELECT w.id INTO v_warehouse_id
  FROM warehouses w
  JOIN branch_warehouses bw ON w.id = bw.warehouse_id
  WHERE bw.branch_id = p_branch_id
    AND bw.is_primary = true
    AND w.is_active = true
  LIMIT 1;
  
  -- If no primary warehouse, get any active warehouse linked to branch
  IF v_warehouse_id IS NULL THEN
    SELECT w.id INTO v_warehouse_id
    FROM warehouses w
    JOIN branch_warehouses bw ON w.id = bw.warehouse_id
    WHERE bw.branch_id = p_branch_id
      AND w.is_active = true
    LIMIT 1;
  END IF;
  
  -- If still no warehouse, get any active shared warehouse (branch_id IS NULL) for the business
  IF v_warehouse_id IS NULL THEN
    SELECT w.id INTO v_warehouse_id
    FROM warehouses w
    JOIN branches b ON w.business_id = b.business_id
    WHERE b.id = p_branch_id
      AND w.branch_id IS NULL
      AND w.is_active = true
    LIMIT 1;
  END IF;
  
  RETURN v_warehouse_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_default_warehouse_for_branch IS 'Returns the default warehouse for a branch. Priority: 1) Primary warehouse linked via branch_warehouses, 2) Any warehouse linked to branch, 3) Any shared warehouse (branch_id IS NULL) in the same business.';
