-- Phase 1: Enhance credit_notes with GST fields
-- This enables proper credit note reporting in GSTR-1

-- Add GST fields to credit_notes
ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS cgst_total DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_total DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_total DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS place_of_supply_state_code VARCHAR(2),
  ADD COLUMN IF NOT EXISTS original_invoice_date DATE;

-- Backfill: Calculate GST breakdown from tax_total
-- Logic: If linked invoice has igst_total > 0, all tax is IGST. Otherwise, split equally.
UPDATE credit_notes cn
SET 
  cgst_total = CASE 
    WHEN EXISTS (
      SELECT 1 FROM invoices inv 
      WHERE inv.id = cn.invoice_id 
      AND inv.igst_total > 0
    ) THEN 0
    ELSE (cn.tax_total / 2)
  END,
  sgst_total = CASE 
    WHEN EXISTS (
      SELECT 1 FROM invoices inv 
      WHERE inv.id = cn.invoice_id 
      AND inv.igst_total > 0
    ) THEN 0
    ELSE (cn.tax_total / 2)
  END,
  igst_total = CASE 
    WHEN EXISTS (
      SELECT 1 FROM invoices inv 
      WHERE inv.id = cn.invoice_id 
      AND inv.igst_total > 0
    ) THEN cn.tax_total
    ELSE 0
  END,
  place_of_supply_state_code = (
    SELECT inv.place_of_supply_state_code 
    FROM invoices inv 
    WHERE inv.id = cn.invoice_id 
    LIMIT 1
  ),
  original_invoice_date = (
    SELECT inv.invoice_date 
    FROM invoices inv 
    WHERE inv.id = cn.invoice_id 
    LIMIT 1
  )
WHERE cn.cgst_total = 0 AND cn.sgst_total = 0 AND cn.igst_total = 0;

-- Add comments
COMMENT ON COLUMN credit_notes.cgst_total IS 'Total CGST amount on credit note';
COMMENT ON COLUMN credit_notes.sgst_total IS 'Total SGST amount on credit note';
COMMENT ON COLUMN credit_notes.igst_total IS 'Total IGST amount on credit note';
COMMENT ON COLUMN credit_notes.place_of_supply_state_code IS 'Place of Supply state code';
COMMENT ON COLUMN credit_notes.original_invoice_date IS 'Date of original invoice for reference period determination';

