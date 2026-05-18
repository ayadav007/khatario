-- Migration 136: Add location_id to purchase_items for warehouse tracking
-- This enables tracking which warehouse stock was received into
-- 
-- IMPORTANT: 
-- - Do NOT add defaults
-- - Do NOT auto-fill existing records
-- - Column is nullable to support legacy purchases
-- - When warehouse mode is enabled, location_id becomes mandatory at application level

-- Add location_id column (references warehouses, not business_locations)
ALTER TABLE purchase_items 
ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_purchase_items_location ON purchase_items(location_id);

-- Create composite index for common queries (warehouse + item lookups)
CREATE INDEX IF NOT EXISTS idx_purchase_items_location_item ON purchase_items(location_id, item_id);

-- Add comment
COMMENT ON COLUMN purchase_items.location_id IS 'Warehouse/location where the stock was received. NULL for legacy purchases or when warehouse mode is disabled. MANDATORY when warehouse mode is enabled.';
