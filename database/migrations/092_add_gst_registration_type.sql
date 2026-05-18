-- Migration: Add GST Registration Type to businesses
-- Purpose: Auto-determine invoice document type based on GST scheme
-- Date: 2026-01-02

-- Add GST registration type column
ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS gst_registration_type VARCHAR(20) DEFAULT 'regular';

-- Valid values:
-- 'regular' - Regular GST registration (can charge GST, issue Tax Invoices)
-- 'composition' - Composition Scheme (cannot charge GST, must issue Bill of Supply)
-- 'unregistered' - No GST registration (for businesses below threshold)

COMMENT ON COLUMN businesses.gst_registration_type 
IS 'GST Registration Type: regular (normal GST), composition (composition scheme - cannot charge GST), unregistered (no GSTIN)';

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_businesses_gst_type ON businesses(gst_registration_type);

-- Update existing businesses to 'regular' if they have a GSTIN
UPDATE businesses 
SET gst_registration_type = 'regular' 
WHERE gstin IS NOT NULL AND gstin != '' 
AND gst_registration_type IS NULL;

-- Update existing businesses to 'unregistered' if they don't have a GSTIN
UPDATE businesses 
SET gst_registration_type = 'unregistered' 
WHERE (gstin IS NULL OR gstin = '') 
AND gst_registration_type IS NULL;

