-- Supplier Hub: a purchase converted from a linked supplier's sales invoice remembers that invoice.
-- Replaces the old "same bill_number" duplicate check, which blocked two suppliers that happen
-- to use the same invoice number and missed a re-import after the bill number was edited.

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS source_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_business_id UUID REFERENCES businesses(id) ON DELETE SET NULL;

COMMENT ON COLUMN purchases.source_invoice_id IS
  'Sales invoice of a linked supplier business this purchase was created from (Supplier Hub)';
COMMENT ON COLUMN purchases.source_business_id IS
  'Business that issued source_invoice_id';

-- One live purchase per source invoice per buyer; a cancelled purchase frees the invoice again.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_purchases_source_invoice
  ON purchases (business_id, source_invoice_id)
  WHERE source_invoice_id IS NOT NULL AND status <> 'cancelled';
