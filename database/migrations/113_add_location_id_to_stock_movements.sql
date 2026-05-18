-- Migration 113: Add location_id to stock_movements table
-- This enables warehouse-level stock movement tracking for historical reporting

-- Add location_id column
ALTER TABLE stock_movements 
ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES business_locations(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_stock_movements_location ON stock_movements(location_id);

-- Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_stock_movements_location_item ON stock_movements(location_id, item_id);

-- Add comment
COMMENT ON COLUMN stock_movements.location_id IS 'Warehouse/location where the stock movement occurred. NULL for legacy records or global stock movements.';
