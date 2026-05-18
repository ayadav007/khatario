-- Migration: Add business type, industry, and business model to businesses table
-- Date: 2024

-- Add business type, industry, and business model columns
ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS business_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS industry VARCHAR(100),
ADD COLUMN IF NOT EXISTS business_model VARCHAR(50);

-- Add comments for documentation
COMMENT ON COLUMN businesses.business_type IS 'Type of business: retail, wholesaler, distributor, manufacturer, service, other';
COMMENT ON COLUMN businesses.industry IS 'Industry category: pharmaceuticals, textiles, garments, electronics, food_beverages, automotive, construction, services, other';
COMMENT ON COLUMN businesses.business_model IS 'Business model: b2b, b2c, b2b2c, export, mixed';

-- Create index for faster queries by industry
CREATE INDEX IF NOT EXISTS idx_businesses_industry ON businesses(industry);
CREATE INDEX IF NOT EXISTS idx_businesses_business_type ON businesses(business_type);

