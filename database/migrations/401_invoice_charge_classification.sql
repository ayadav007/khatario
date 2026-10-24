-- Classified sales-invoice charges. Existing invoices are not rewritten:
-- charges_included stays false, so a historical additional_charges amount is not taxed again.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS charges_included BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS invoice_charges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  purpose TEXT,
  amount NUMERIC(12,2) NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('follows_goods', 'separate_supply')),
  hsn_sac VARCHAR(10),
  tax_rate NUMERIC(5,2),
  taxable_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  cgst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  sgst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invoice_charges_invoice ON invoice_charges (invoice_id);

COMMENT ON COLUMN invoices.charges_included IS
  'True when additional_charges is already inside subtotal. False on invoices saved before classification: that header amount stays untaxed.';
