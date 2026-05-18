-- Migration: Add warehouses_enabled to business_settings table
-- Date: 2024

-- Add warehouses_enabled column to business_settings
ALTER TABLE business_settings 
ADD COLUMN IF NOT EXISTS warehouses_enabled BOOLEAN DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN business_settings.warehouses_enabled IS 'Enable multi-warehouse/location management for inventory';

