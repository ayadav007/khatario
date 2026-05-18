-- Migration: Add product_variants_enabled to business_settings table
-- Date: 2024

-- Add product_variants_enabled column to business_settings
ALTER TABLE business_settings 
ADD COLUMN IF NOT EXISTS product_variants_enabled BOOLEAN DEFAULT false;

-- Auto-enable product variants for existing businesses with textiles/garments industry
UPDATE business_settings bs
SET product_variants_enabled = true
FROM businesses b
WHERE bs.business_id = b.id 
  AND b.industry IN ('textiles', 'garments')
  AND bs.product_variants_enabled = false;

-- Add comment for documentation
COMMENT ON COLUMN business_settings.product_variants_enabled IS 'Enable product variants (color, size, etc.) for businesses like garments and textiles';

