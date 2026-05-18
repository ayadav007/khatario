-- Migration 115: Add location_id to credit_note_items for warehouse tracking
-- This enables restoring stock to the correct warehouse when processing returns

ALTER TABLE credit_note_items 
ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES business_locations(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_credit_note_items_location ON credit_note_items(location_id);

-- Add comment
COMMENT ON COLUMN credit_note_items.location_id IS 'Warehouse/location where the returned stock should be restored. Should match the location from the original invoice.';
