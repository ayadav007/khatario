-- Migration 116: Add location_id to invoice_items for warehouse tracking
-- This enables tracking which warehouse stock was sold from

ALTER TABLE invoice_items 
ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES business_locations(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_invoice_items_location ON invoice_items(location_id);

-- Add comment
COMMENT ON COLUMN invoice_items.location_id IS 'Warehouse/location from which the stock was sold. Used for accurate stock tracking and returns processing.';
