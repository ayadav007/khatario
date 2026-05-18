-- Phase 2: Enhance purchase_items with GST breakdown
-- This enables item-level ITC calculation for GSTR-2

-- Add GST and HSN fields to purchase_items
ALTER TABLE purchase_items
  ADD COLUMN IF NOT EXISTS hsn_sac VARCHAR(10),
  ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_value DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(12,2) DEFAULT 0;

-- Backfill: Calculate taxable_value from quantity * unit_price (assuming no discount initially)
UPDATE purchase_items
SET taxable_value = quantity * unit_price
WHERE taxable_value = 0;

-- Backfill: Calculate tax_amount from purchase-level tax_total (proportional distribution)
-- This is a simplified approach. Ideally, tax should be calculated at item level during entry.
UPDATE purchase_items pi
SET 
  tax_amount = CASE 
    WHEN pi.tax_rate > 0 THEN (pi.taxable_value * pi.tax_rate / 100)
    ELSE 0
  END,
  cgst_amount = CASE 
    WHEN pi.tax_rate > 0 AND EXISTS (
      SELECT 1 FROM purchases p 
      WHERE p.id = pi.purchase_id 
      AND p.igst_total = 0
    ) THEN (pi.taxable_value * pi.tax_rate / 200)  -- Half of tax rate for CGST
    ELSE 0
  END,
  sgst_amount = CASE 
    WHEN pi.tax_rate > 0 AND EXISTS (
      SELECT 1 FROM purchases p 
      WHERE p.id = pi.purchase_id 
      AND p.igst_total = 0
    ) THEN (pi.taxable_value * pi.tax_rate / 200)  -- Half of tax rate for SGST
    ELSE 0
  END,
  igst_amount = CASE 
    WHEN pi.tax_rate > 0 AND EXISTS (
      SELECT 1 FROM purchases p 
      WHERE p.id = pi.purchase_id 
      AND p.igst_total > 0
    ) THEN (pi.taxable_value * pi.tax_rate / 100)
    ELSE 0
  END
WHERE tax_amount = 0;

-- Backfill: Copy HSN/SAC from items table if available
UPDATE purchase_items pi
SET hsn_sac = (
  SELECT i.hsn_sac 
  FROM items i 
  WHERE i.id = pi.item_id 
  LIMIT 1
)
WHERE hsn_sac IS NULL AND item_id IS NOT NULL;

-- Add comments
COMMENT ON COLUMN purchase_items.hsn_sac IS 'HSN or SAC code for the item';
COMMENT ON COLUMN purchase_items.discount_percent IS 'Discount percentage';
COMMENT ON COLUMN purchase_items.discount_amount IS 'Discount amount';
COMMENT ON COLUMN purchase_items.taxable_value IS 'Taxable value after discount, before tax';
COMMENT ON COLUMN purchase_items.cgst_amount IS 'CGST amount for this line item';
COMMENT ON COLUMN purchase_items.sgst_amount IS 'SGST amount for this line item';
COMMENT ON COLUMN purchase_items.igst_amount IS 'IGST amount for this line item';
COMMENT ON COLUMN purchase_items.tax_amount IS 'Total tax amount (CGST+SGST or IGST)';

