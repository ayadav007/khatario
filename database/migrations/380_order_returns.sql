-- 380: Order returns (RMA) for every channel, and money paid back against a credit note.
--
-- A return belongs to a final invoice. Lifecycle:
--   requested (buyer asked) -> approved | rejected
--   approved -> received (goods inspected; credit note posted) -> closed (refund or credit settled)
--   requested | approved -> cancelled
-- Lines record what came back and whether it goes back on the shelf (restock) or is written off (damaged).
--
-- credit_note_refunds: cash / UPI / bank paid back to the customer for a credit note. Each row
-- posts one voucher (voucher_type 'credit_note_refund': Dr receivable, Cr cash/bank).

CREATE TABLE IF NOT EXISTS order_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  return_number VARCHAR(20) NOT NULL,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  fulfilment_id UUID REFERENCES order_fulfilments(id) ON DELETE SET NULL,
  store_order_id UUID REFERENCES store_orders(id) ON DELETE SET NULL,
  sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'received', 'closed', 'cancelled')),
  initiated_by VARCHAR(12) NOT NULL DEFAULT 'merchant'
    CHECK (initiated_by IN ('merchant', 'customer', 'courier')),
  reason VARCHAR(24) NOT NULL DEFAULT 'other'
    CHECK (reason IN ('damaged', 'wrong_item', 'not_as_described', 'size_fit', 'not_needed', 'not_delivered', 'other')),
  reason_note TEXT,
  rejected_reason TEXT,
  -- How the buyer is paid back once the credit note exists.
  refund_method VARCHAR(16)
    CHECK (refund_method IS NULL OR refund_method IN ('store_credit', 'cash', 'upi', 'bank')),
  credit_note_id UUID REFERENCES credit_notes(id) ON DELETE SET NULL,
  credit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  refunded_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  -- Items taken off the order before it was packed (order edit): they never travel, so parcels,
  -- pick lists and slips leave them out.
  removed_before_dispatch BOOLEAN NOT NULL DEFAULT false,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_order_returns_number UNIQUE (business_id, return_number)
);

CREATE INDEX IF NOT EXISTS idx_order_returns_business_status
  ON order_returns (business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_returns_invoice ON order_returns (invoice_id);
CREATE INDEX IF NOT EXISTS idx_order_returns_store_order ON order_returns (store_order_id) WHERE store_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_returns_fulfilment ON order_returns (fulfilment_id) WHERE fulfilment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES order_returns(id) ON DELETE CASCADE,
  invoice_item_id UUID REFERENCES invoice_items(id) ON DELETE SET NULL,
  item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES item_variants(id) ON DELETE SET NULL,
  item_name VARCHAR(255) NOT NULL,
  unit VARCHAR(20),
  quantity NUMERIC(15, 3) NOT NULL CHECK (quantity > 0),
  -- Filled when the goods are inspected.
  received_qty NUMERIC(15, 3) CHECK (received_qty IS NULL OR received_qty >= 0),
  condition VARCHAR(10) CHECK (condition IS NULL OR condition IN ('restock', 'damaged')),
  -- Taxable value per unit on the original bill (credit note re-applies the bill's tax rate).
  unit_price NUMERIC(14, 4) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  sort_order SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_order_return_items_return ON order_return_items (return_id);

CREATE TABLE IF NOT EXISTS credit_note_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  credit_note_id UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_return_id UUID REFERENCES order_returns(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  refund_date DATE NOT NULL,
  mode VARCHAR(16) NOT NULL CHECK (mode IN ('cash', 'upi', 'bank')),
  payment_account_id UUID NOT NULL REFERENCES accounts(id),
  reference TEXT,
  voucher_number VARCHAR(30) NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_note_refunds_note ON credit_note_refunds (credit_note_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_refunds_customer ON credit_note_refunds (business_id, customer_id, refund_date);

-- Credit-note lines for goods that came back damaged are not put back in stock and carry no cost back.
ALTER TABLE credit_note_items ADD COLUMN IF NOT EXISTS restocked BOOLEAN NOT NULL DEFAULT true;

-- Buyers can ask for a return from their store account for this many days after delivery (0 = off).
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS store_return_window_days SMALLINT NOT NULL DEFAULT 7;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_settings_store_return_window_check'
  ) THEN
    ALTER TABLE business_settings
      ADD CONSTRAINT business_settings_store_return_window_check
      CHECK (store_return_window_days BETWEEN 0 AND 90);
  END IF;
END $$;

-- For databases that ran an earlier draft of this migration.
ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS removed_before_dispatch BOOLEAN NOT NULL DEFAULT false;
