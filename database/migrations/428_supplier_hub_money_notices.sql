-- 428: Money between connected businesses.
-- When a buyer records a payment, or a debit note (purchase return), against a purchase that came
-- from a connected supplier's bill (purchases.source_invoice_id), the supplier gets a notice:
-- record the matching receipt in one tap, or open a credit note pre-filled for that bill. Both
-- ledgers then agree. A credit note on that bill made after the notice settles a debit-note notice.

CREATE TABLE IF NOT EXISTS supplier_hub_money_notices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('payment', 'debit_note')),
  buyer_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vendor_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  source_id UUID NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  happened_on DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_mode VARCHAR(40),
  note TEXT,
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'recorded', 'dismissed')),
  recorded_doc_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ,
  UNIQUE (kind, source_id)
);

CREATE INDEX IF NOT EXISTS idx_hub_money_notices_vendor ON supplier_hub_money_notices (vendor_business_id, status, created_at DESC);
