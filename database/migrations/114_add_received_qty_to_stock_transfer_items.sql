-- Migration 114: Add received_qty to stock_transfer_items for discrepancy tracking
-- This enables tracking of short/excess quantities during transfer receiving

ALTER TABLE stock_transfer_items 
ADD COLUMN IF NOT EXISTS received_qty DECIMAL(10, 2);

-- Add comment
COMMENT ON COLUMN stock_transfer_items.received_qty IS 'Actual quantity received at destination. NULL until transfer is received. If different from qty, indicates a discrepancy.';
