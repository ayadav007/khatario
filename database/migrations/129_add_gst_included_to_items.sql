-- Migration: Add GST Included flag to items
-- Purpose: Support items where GST is already included in the selling price

-- Add gst_included column to items table
ALTER TABLE items 
ADD COLUMN IF NOT EXISTS gst_included BOOLEAN DEFAULT FALSE;

-- Add mrp (max retail price) column to items table
ALTER TABLE items 
ADD COLUMN IF NOT EXISTS mrp DECIMAL(12, 2);

-- Add comment
COMMENT ON COLUMN items.gst_included IS 'If true, selling_price includes GST. If false, GST is calculated on top of selling_price.';
COMMENT ON COLUMN items.mrp IS 'Maximum Retail Price - the final price (including GST) should not exceed this';
