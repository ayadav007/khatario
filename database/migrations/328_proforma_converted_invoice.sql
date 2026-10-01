-- The tax invoice created from a proforma. Set only by the conversion transaction.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS converted_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_converted_invoice_id
  ON invoices (converted_invoice_id)
  WHERE converted_invoice_id IS NOT NULL;

COMMENT ON COLUMN invoices.converted_invoice_id IS
  'Tax invoice created from this proforma. Written only by proforma conversion.';
