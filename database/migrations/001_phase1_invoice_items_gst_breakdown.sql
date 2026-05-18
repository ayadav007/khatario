-- Phase 1: Add line-item GST breakdown to invoice_items
-- This enables accurate GSTR-1 HSN-wise summary generation

-- Add GST breakdown columns to invoice_items
ALTER TABLE invoice_items 
  ADD COLUMN IF NOT EXISTS cgst_amount DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_value DECIMAL(12,2) DEFAULT 0;

-- Backfill existing data: Calculate GST breakdown from tax_amount
-- Logic: If invoice has igst_total > 0, all tax is IGST. Otherwise, split equally between CGST and SGST.
UPDATE invoice_items ii
SET 
  taxable_value = (ii.quantity * ii.unit_price) - COALESCE(ii.discount_amount, 0),
  cgst_amount = CASE 
    WHEN EXISTS (
      SELECT 1 FROM invoices inv 
      WHERE inv.id = ii.invoice_id 
      AND inv.igst_total > 0
    ) THEN 0
    ELSE (ii.tax_amount / 2)
  END,
  sgst_amount = CASE 
    WHEN EXISTS (
      SELECT 1 FROM invoices inv 
      WHERE inv.id = ii.invoice_id 
      AND inv.igst_total > 0
    ) THEN 0
    ELSE (ii.tax_amount / 2)
  END,
  igst_amount = CASE 
    WHEN EXISTS (
      SELECT 1 FROM invoices inv 
      WHERE inv.id = ii.invoice_id 
      AND inv.igst_total > 0
    ) THEN ii.tax_amount
    ELSE 0
  END
WHERE taxable_value = 0 OR cgst_amount = 0 OR sgst_amount = 0 OR igst_amount = 0;

-- Add comment
COMMENT ON COLUMN invoice_items.cgst_amount IS 'CGST amount for this line item';
COMMENT ON COLUMN invoice_items.sgst_amount IS 'SGST amount for this line item';
COMMENT ON COLUMN invoice_items.igst_amount IS 'IGST amount for this line item';
COMMENT ON COLUMN invoice_items.taxable_value IS 'Taxable value after discount, before tax';

