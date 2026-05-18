-- Purchase header: price mode, supplier state for GST split, invoice number alias
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS price_mode VARCHAR(16) NOT NULL DEFAULT 'exclusive',
  ADD COLUMN IF NOT EXISTS supplier_state_code VARCHAR(2),
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(100);

COMMENT ON COLUMN purchases.price_mode IS 'exclusive = pre-tax rates; inclusive = rates include GST';
COMMENT ON COLUMN purchases.supplier_state_code IS '2-digit GST state code of supplier (for CGST/SGST vs IGST split)';
COMMENT ON COLUMN purchases.invoice_number IS 'Supplier invoice number (may mirror bill_number)';

UPDATE purchases
SET invoice_number = bill_number
WHERE (invoice_number IS NULL OR TRIM(invoice_number) = '')
  AND bill_number IS NOT NULL
  AND TRIM(bill_number) <> '';

-- Line items: per-line tax mode and unit label
ALTER TABLE purchase_items
  ADD COLUMN IF NOT EXISTS tax_mode VARCHAR(16) NOT NULL DEFAULT 'exclusive',
  ADD COLUMN IF NOT EXISTS unit VARCHAR(50) DEFAULT 'PCS';

COMMENT ON COLUMN purchase_items.tax_mode IS 'exclusive or inclusive — how unit_price + discount are interpreted';
COMMENT ON COLUMN purchase_items.unit IS 'Unit of measure (PCS, NOS, kg, etc.)';
