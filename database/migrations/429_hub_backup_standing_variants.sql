-- 429: Supplier Hub for more trades.
--   * items.backup_supplier_id: when the default supplier cannot send some of an order, the rest
--     goes to this connected supplier as a new order (origin 'backup').
--   * supply_standing_orders: a fixed order on fixed weekdays (milk, bread, eggs, papers). The
--     supplier accepts it once; each due day it becomes a confirmed order (origin 'standing').
--   * item_variants.min_stock and supply_order_lines.buyer_variant_id: sizes and colours run low
--     on their own, so suggested orders can name the size.

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS backup_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

ALTER TABLE item_variants
  ADD COLUMN IF NOT EXISTS min_stock NUMERIC(14, 4),
  ADD COLUMN IF NOT EXISTS reorder_qty NUMERIC(14, 4);

ALTER TABLE supply_order_lines
  ADD COLUMN IF NOT EXISTS buyer_variant_id UUID REFERENCES item_variants(id) ON DELETE SET NULL;

ALTER TABLE supply_orders DROP CONSTRAINT IF EXISTS supply_orders_origin_check;
ALTER TABLE supply_orders ADD CONSTRAINT supply_orders_origin_check
  CHECK (origin IN ('buyer', 'vendor', 'suggested', 'catalog', 'backorder', 'backup', 'standing'));

CREATE TABLE IF NOT EXISTS supply_standing_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buyer_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vendor_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  -- 0 = Sunday ... 6 = Saturday, in Indian time
  weekdays SMALLINT[] NOT NULL CHECK (cardinality(weekdays) > 0),
  status VARCHAR(12) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'paused', 'ended')),
  notes TEXT,
  last_run_on DATE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMPTZ,
  CONSTRAINT supply_standing_pair_ne CHECK (buyer_business_id <> vendor_business_id)
);

CREATE INDEX IF NOT EXISTS idx_standing_orders_vendor ON supply_standing_orders (vendor_business_id, status);
CREATE INDEX IF NOT EXISTS idx_standing_orders_buyer ON supply_standing_orders (buyer_business_id, status);

CREATE TABLE IF NOT EXISTS supply_standing_order_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  standing_order_id UUID NOT NULL REFERENCES supply_standing_orders(id) ON DELETE CASCADE,
  buyer_item_id UUID REFERENCES items(id) ON DELETE CASCADE,
  vendor_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  item_name VARCHAR(255) NOT NULL,
  qty NUMERIC(14, 4) NOT NULL CHECK (qty > 0),
  buyer_units_per_vendor_unit NUMERIC(14, 4) NOT NULL DEFAULT 1 CHECK (buyer_units_per_vendor_unit > 0),
  sort_order INT NOT NULL DEFAULT 0
);

ALTER TABLE supply_orders
  ADD COLUMN IF NOT EXISTS standing_order_id UUID REFERENCES supply_standing_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS standing_run_on DATE;

-- One order per standing order per day.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_supply_orders_standing_day
  ON supply_orders (standing_order_id, standing_run_on)
  WHERE standing_order_id IS NOT NULL;
