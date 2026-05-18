-- Phase 2: Enhance purchases table with GST fields
-- This enables GSTR-2/2B generation (inward supplies)

-- Add GST fields to purchases
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS cgst_total DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_total DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_total DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS place_of_supply_state_code VARCHAR(2),
  ADD COLUMN IF NOT EXISTS is_reverse_charge BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS supplier_gstin VARCHAR(15),
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(50) DEFAULT 'tax_invoice',
  ADD COLUMN IF NOT EXISTS itc_eligible BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS itc_availed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS itc_availed_date DATE;

-- Backfill: Denormalize supplier_gstin from suppliers table
UPDATE purchases p
SET supplier_gstin = (
  SELECT s.gstin 
  FROM suppliers s 
  WHERE s.id = p.supplier_id 
  LIMIT 1
)
WHERE supplier_gstin IS NULL AND supplier_id IS NOT NULL;

-- Backfill: Calculate GST breakdown from tax_total
-- Logic: Split tax_total equally between CGST and SGST (can be improved with actual POS data)
-- Note: This is a best-effort. Manual review recommended for accuracy.
UPDATE purchases p
SET 
  cgst_total = CASE 
    WHEN p.tax_total > 0 THEN (p.tax_total / 2)
    ELSE 0
  END,
  sgst_total = CASE 
    WHEN p.tax_total > 0 THEN (p.tax_total / 2)
    ELSE 0
  END,
  igst_total = 0  -- Default to 0, can be updated based on POS
WHERE cgst_total = 0 AND sgst_total = 0 AND igst_total = 0;

-- Add comments
COMMENT ON COLUMN purchases.cgst_total IS 'Total CGST on purchase';
COMMENT ON COLUMN purchases.sgst_total IS 'Total SGST on purchase';
COMMENT ON COLUMN purchases.igst_total IS 'Total IGST on purchase';
COMMENT ON COLUMN purchases.place_of_supply_state_code IS 'Place of Supply state code';
COMMENT ON COLUMN purchases.is_reverse_charge IS 'Whether reverse charge applies';
COMMENT ON COLUMN purchases.supplier_gstin IS 'GSTIN of supplier (denormalized)';
COMMENT ON COLUMN purchases.document_type IS 'Document type: tax_invoice, bill_of_supply, bill_of_entry, etc.';
COMMENT ON COLUMN purchases.itc_eligible IS 'Whether ITC is eligible on this purchase';
COMMENT ON COLUMN purchases.itc_availed IS 'Whether ITC has been availed';
COMMENT ON COLUMN purchases.itc_availed_date IS 'Date when ITC was availed';

