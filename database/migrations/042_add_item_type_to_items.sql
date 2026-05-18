-- Migration: 042_add_item_type_to_items.sql
-- Add item_type field and make selling_price nullable

ALTER TABLE items 
ADD COLUMN IF NOT EXISTS item_type VARCHAR(20) DEFAULT 'goods' 
CHECK (item_type IN ('goods', 'service'));

-- Make selling_price nullable (for services that are only purchased)
ALTER TABLE items 
ALTER COLUMN selling_price DROP NOT NULL;

-- Update existing items: Auto-detect services by SAC code (starts with 99)
UPDATE items 
SET item_type = 'service' 
WHERE hsn_sac IS NOT NULL AND hsn_sac LIKE '99%';

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_items_item_type ON items(item_type, business_id);

-- Add comments
COMMENT ON COLUMN items.item_type IS 'Type of item: goods or service. Services do not track stock.';
COMMENT ON COLUMN items.selling_price IS 'Selling price. Optional for services that are only purchased (not sold).';

