-- Migration to add barcode fields to items and item_variants
-- This enables proper barcode scanning and validation

-- Add barcode fields to items table
ALTER TABLE items 
ADD COLUMN IF NOT EXISTS barcode VARCHAR(32),
ADD COLUMN IF NOT EXISTS barcode_type VARCHAR(16);

-- Add index for fast barcode lookup
CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode) WHERE barcode IS NOT NULL;

-- Add unique constraint per business (same barcode can exist in different businesses)
-- But within a business, barcode must be unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_barcode_business_unique 
ON items(business_id, barcode) 
WHERE barcode IS NOT NULL;

-- Add barcode to item_variants (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'item_variants') THEN
        ALTER TABLE item_variants 
        ADD COLUMN IF NOT EXISTS barcode VARCHAR(32),
        ADD COLUMN IF NOT EXISTS barcode_type VARCHAR(16);
        
        CREATE INDEX IF NOT EXISTS idx_item_variants_barcode ON item_variants(barcode) WHERE barcode IS NOT NULL;
        
        -- Variant barcodes must be unique per business
        CREATE UNIQUE INDEX IF NOT EXISTS idx_item_variants_barcode_business_unique 
        ON item_variants(item_id, barcode) 
        WHERE barcode IS NOT NULL;
    END IF;
END $$;

COMMENT ON COLUMN items.barcode IS 'Barcode number (EAN-13, UPC, Code128, etc.)';
COMMENT ON COLUMN items.barcode_type IS 'Type of barcode: EAN13, UPC, CODE128, QR, CUSTOM';
COMMENT ON COLUMN item_variants.barcode IS 'Barcode number for this specific variant';
COMMENT ON COLUMN item_variants.barcode_type IS 'Type of barcode for this variant';

