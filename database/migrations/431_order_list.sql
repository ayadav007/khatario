-- 431: Order list. Walk the shop, pick what is running out, and send each supplier their part.
-- One open list per business, shared by everyone who works on it (a staff member can fill it and
-- the owner send it). Each line remembers its supplier: the item's default supplier, else the
-- supplier it was last bought from, else none until the user picks one for a group of lines.
-- items.rack: optional rack or shelf, so the list and the low-stock suggestions follow the shop.

ALTER TABLE items ADD COLUMN IF NOT EXISTS rack VARCHAR(40);
COMMENT ON COLUMN items.rack IS 'Rack or shelf where the item sits, e.g. A3; the order list is sorted by it';

CREATE TABLE IF NOT EXISTS order_lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sent')),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_order_lists_open ON order_lists (business_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS order_list_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  list_id UUID NOT NULL REFERENCES order_lists(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty NUMERIC(14, 4) NOT NULL CHECK (qty > 0),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (list_id, item_id)
);

-- What each send produced, so the list can show "sent to Gupta on WhatsApp" afterwards.
CREATE TABLE IF NOT EXISTS order_list_sends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  list_id UUID NOT NULL REFERENCES order_lists(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  way VARCHAR(10) NOT NULL CHECK (way IN ('hub', 'whatsapp')),
  supply_order_id UUID REFERENCES supply_orders(id) ON DELETE SET NULL,
  invite_order_id UUID REFERENCES supplier_invite_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
