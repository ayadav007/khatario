-- Migration 133: Warehouse Transfer Improvements
-- Adds approval workflow, proper quantity tracking, and cost snapshots
-- Fixes transfer flow to match Zoho-style transfer orders

-- Step 1: Add approval columns to stock_transfers
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;

-- Step 2: Update status to include 'draft' and 'pending_approval'
-- Note: We'll use CHECK constraint to validate status values
ALTER TABLE stock_transfers
  DROP CONSTRAINT IF EXISTS stock_transfers_status_check;

ALTER TABLE stock_transfers
  ADD CONSTRAINT stock_transfers_status_check 
  CHECK (status IN ('draft', 'pending_approval', 'pending', 'in_transit', 'completed', 'cancelled'));

-- Step 3: Change default status to 'draft' (was 'pending')
ALTER TABLE stock_transfers
  ALTER COLUMN status SET DEFAULT 'draft';

-- Step 4: Add quantity tracking columns to stock_transfer_items
ALTER TABLE stock_transfer_items
  ADD COLUMN IF NOT EXISTS quantity_requested DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS quantity_dispatched DECIMAL(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_snapshot DECIMAL(15, 2);

-- Step 5: Migrate existing data
-- Set quantity_requested = qty for existing records
UPDATE stock_transfer_items
SET quantity_requested = qty
WHERE quantity_requested IS NULL;

-- Set quantity_dispatched = qty for completed/in_transit transfers
UPDATE stock_transfer_items sti
SET quantity_dispatched = sti.qty
FROM stock_transfers st
WHERE sti.transfer_id = st.id
  AND st.status IN ('in_transit', 'completed')
  AND sti.quantity_dispatched IS NULL;

-- Step 6: Add comments
COMMENT ON COLUMN stock_transfers.approved_by IS 'User who approved the transfer (NULL if not approved)';
COMMENT ON COLUMN stock_transfers.approved_at IS 'Timestamp when transfer was approved';
COMMENT ON COLUMN stock_transfers.status IS 'Transfer status: draft, pending_approval, pending, in_transit, completed, cancelled';
COMMENT ON COLUMN stock_transfer_items.quantity_requested IS 'Original quantity requested in transfer';
COMMENT ON COLUMN stock_transfer_items.quantity_dispatched IS 'Quantity actually dispatched from source warehouse';
COMMENT ON COLUMN stock_transfer_items.received_qty IS 'Quantity actually received at destination warehouse';
COMMENT ON COLUMN stock_transfer_items.cost_snapshot IS 'Item cost at time of dispatch (for cost tracking)';

-- Step 7: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_approved_by ON stock_transfers(approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from_location ON stock_transfers(from_location_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to_location ON stock_transfers(to_location_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer_id ON stock_transfer_items(transfer_id);

COMMENT ON TABLE stock_transfers IS 'Warehouse-to-warehouse stock transfers with approval workflow';
COMMENT ON TABLE stock_transfer_items IS 'Items in stock transfers with quantity tracking (requested, dispatched, received)';
