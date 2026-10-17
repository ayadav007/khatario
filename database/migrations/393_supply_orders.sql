-- Supplier Hub phases 3–4: multi-line orders between a buyer and a connected supplier.
--
-- Flow (decision 1: the supplier proposes, the buyer confirms; nothing is invoiced before the
-- buyer has agreed the quantities):
--   supplier side:  draft (suggested from the buyer's low stock, or made by hand)
--                   -> proposed (sent to the buyer) -> confirmed (buyer agreed, may edit qty)
--   buyer side:     pending (buyer ordered) -> confirmed | partial | declined (supplier answered)
--   then:           invoiced (supplier raised the bill) -> received (buyer received it)
--   any time before invoicing: cancelled
-- Quantities on lines are in the supplier's unit; buyer_units_per_vendor_unit converts them.

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS reorder_qty NUMERIC(14, 4),
  ADD COLUMN IF NOT EXISTS max_stock NUMERIC(14, 4);

COMMENT ON COLUMN items.reorder_qty IS 'Quantity to order when stock reaches min_stock (Supplier Hub suggestions)';
COMMENT ON COLUMN items.max_stock IS 'Order up to this level when stock reaches min_stock (Supplier Hub suggestions)';

CREATE TABLE IF NOT EXISTS supply_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buyer_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vendor_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('draft', 'proposed', 'pending', 'confirmed', 'partial', 'declined',
                      'invoiced', 'received', 'cancelled')),
  origin VARCHAR(20) NOT NULL DEFAULT 'buyer'
    CHECK (origin IN ('buyer', 'vendor', 'suggested', 'catalog')),
  need_by DATE,
  notes TEXT,
  created_by_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT supply_orders_pair_ne CHECK (buyer_business_id <> vendor_business_id)
);

CREATE INDEX IF NOT EXISTS idx_supply_orders_buyer ON supply_orders (buyer_business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supply_orders_vendor ON supply_orders (vendor_business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supply_orders_invoice ON supply_orders (invoice_id) WHERE invoice_id IS NOT NULL;

-- At most one suggested draft per pair is open at a time; new low items are added to it.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_supply_orders_open_suggestion
  ON supply_orders (buyer_business_id, vendor_business_id)
  WHERE status = 'draft' AND origin = 'suggested';

CREATE TABLE IF NOT EXISTS supply_order_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES supply_orders(id) ON DELETE CASCADE,
  buyer_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  vendor_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  item_name VARCHAR(255) NOT NULL,
  qty NUMERIC(14, 4) NOT NULL CHECK (qty > 0),
  confirmed_qty NUMERIC(14, 4) CHECK (confirmed_qty >= 0),
  buyer_units_per_vendor_unit NUMERIC(14, 4) NOT NULL DEFAULT 1 CHECK (buyer_units_per_vendor_unit > 0),
  buyer_stock_at_suggestion NUMERIC(14, 4),
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT supply_order_line_has_item CHECK (buyer_item_id IS NOT NULL OR vendor_item_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_supply_order_lines_order ON supply_order_lines (order_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_supply_order_lines_buyer_item ON supply_order_lines (buyer_item_id);

-- Lines must point at the right businesses' items.
CREATE OR REPLACE FUNCTION trg_supply_order_lines_validate()
RETURNS TRIGGER AS $$
DECLARE
  o RECORD;
BEGIN
  SELECT buyer_business_id, vendor_business_id INTO o FROM supply_orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  -- Only check item columns that are being set (deletes cascading through items only clear them).
  IF TG_OP = 'UPDATE'
     AND NEW.buyer_item_id IS NOT DISTINCT FROM OLD.buyer_item_id
     AND NEW.vendor_item_id IS NOT DISTINCT FROM OLD.vendor_item_id THEN
    RETURN NEW;
  END IF;
  IF NEW.buyer_item_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.buyer_item_id IS DISTINCT FROM OLD.buyer_item_id)
     AND NOT EXISTS (
    SELECT 1 FROM items WHERE id = NEW.buyer_item_id AND business_id = o.buyer_business_id
  ) THEN
    RAISE EXCEPTION 'supply_order_lines: buyer_item_id must belong to the buyer' USING ERRCODE = '23514';
  END IF;
  IF NEW.vendor_item_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.vendor_item_id IS DISTINCT FROM OLD.vendor_item_id)
     AND NOT EXISTS (
    SELECT 1 FROM items WHERE id = NEW.vendor_item_id AND business_id = o.vendor_business_id
  ) THEN
    RAISE EXCEPTION 'supply_order_lines: vendor_item_id must belong to the supplier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supply_order_lines_validate ON supply_order_lines;
CREATE TRIGGER trg_supply_order_lines_validate
  BEFORE INSERT OR UPDATE ON supply_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION trg_supply_order_lines_validate();
