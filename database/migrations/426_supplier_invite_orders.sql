-- 426: Order from a supplier who is not on Khatario yet.
-- The buyer sends a private link (usually from their own WhatsApp). The supplier opens it
-- without an account, confirms what they can send or declines, and is invited to join. If they
-- join and open the link signed in, the buyer's supplier record links to their business.

CREATE TABLE IF NOT EXISTS supplier_invite_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buyer_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  token VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(12) NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'viewed', 'confirmed', 'partial', 'declined', 'cancelled')),
  notes TEXT,
  need_by DATE,
  response_note TEXT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  viewed_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  joined_business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_supplier_invite_orders_buyer ON supplier_invite_orders (buyer_business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_invite_orders_supplier ON supplier_invite_orders (supplier_id, created_at DESC);

CREATE TABLE IF NOT EXISTS supplier_invite_order_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invite_order_id UUID NOT NULL REFERENCES supplier_invite_orders(id) ON DELETE CASCADE,
  buyer_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  item_name VARCHAR(255) NOT NULL,
  unit VARCHAR(30),
  qty NUMERIC(14, 4) NOT NULL CHECK (qty > 0),
  confirmed_qty NUMERIC(14, 4) CHECK (confirmed_qty >= 0),
  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_supplier_invite_order_lines_order ON supplier_invite_order_lines (invite_order_id, sort_order);
