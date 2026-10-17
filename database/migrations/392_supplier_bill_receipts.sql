-- Supplier Hub phase 5: what actually arrived against a connected supplier's bill.
-- The buyer's purchase always matches the bill (so GST and the amount owed match the supplier's
-- invoice); short or damaged quantities are recorded here and settled with a purchase return
-- (the buyer's debit note), created from this record.

CREATE TABLE IF NOT EXISTS supplier_bill_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buyer_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vendor_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'received_with_issues')),
  notes TEXT,
  received_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uniq_supplier_bill_receipt_purchase UNIQUE (purchase_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_bill_receipts_buyer
  ON supplier_bill_receipts (buyer_business_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_receipts_vendor
  ON supplier_bill_receipts (vendor_business_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_receipts_invoice
  ON supplier_bill_receipts (invoice_id);

-- Quantities are in the buyer's unit (after the item map's conversion).
CREATE TABLE IF NOT EXISTS supplier_bill_receipt_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id UUID NOT NULL REFERENCES supplier_bill_receipts(id) ON DELETE CASCADE,
  invoice_item_id UUID,
  buyer_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  item_name VARCHAR(255) NOT NULL,
  billed_qty NUMERIC(14, 4) NOT NULL,
  short_qty NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (short_qty >= 0),
  damaged_qty NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  note TEXT,
  CONSTRAINT supplier_bill_receipt_line_qty CHECK (short_qty + damaged_qty <= billed_qty)
);

CREATE INDEX IF NOT EXISTS idx_supplier_bill_receipt_lines_receipt
  ON supplier_bill_receipt_lines (receipt_id);

COMMENT ON TABLE supplier_bill_receipts IS
  'Buyer''s receipt of a connected supplier''s bill: one per purchase created from it';
COMMENT ON TABLE supplier_bill_receipt_lines IS
  'Per bill line: quantity billed, short and damaged, in the buyer''s unit';
