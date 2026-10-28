-- Repack: take N of a bulk item out, put M of a packed item in (docs/REPACK_STOCK_DESIGN.md).
-- A repack is two quantity adjustments (REPACK_OUT on the source, REPACK_IN on the packed item)
-- tied together by stock_repacks, so stock-as-of, FIFO and the adjustments list read them as-is.
-- The full cost taken out of the source, wastage included, goes into the packed item; no voucher.

ALTER TABLE items ADD COLUMN IF NOT EXISTS pack_source_item_id UUID REFERENCES items(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN IF NOT EXISTS pack_source_qty NUMERIC(14, 4);
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_pack_source_check;
ALTER TABLE items ADD CONSTRAINT items_pack_source_check CHECK (
  (pack_source_item_id IS NULL AND pack_source_qty IS NULL)
  OR (pack_source_item_id IS NOT NULL AND pack_source_qty > 0 AND pack_source_item_id <> id)
);
COMMENT ON COLUMN items.pack_source_item_id IS 'Repack: the bulk item this packed item is filled from';
COMMENT ON COLUMN items.pack_source_qty IS 'Repack: source units in one packed unit (1 for a 1 kg packet of rice kept in KG)';
CREATE INDEX IF NOT EXISTS idx_items_pack_source ON items(pack_source_item_id) WHERE pack_source_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stock_repacks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  repack_number VARCHAR(50) NOT NULL,
  repack_date DATE NOT NULL,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  location_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  source_item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  source_qty NUMERIC(15, 3) NOT NULL CHECK (source_qty > 0),
  packed_item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  packed_qty NUMERIC(15, 3) NOT NULL CHECK (packed_qty > 0),
  content_per_unit NUMERIC(14, 4) NOT NULL CHECK (content_per_unit > 0),
  wastage_qty NUMERIC(15, 3) NOT NULL DEFAULT 0 CHECK (wastage_qty >= 0),
  wastage_reason VARCHAR(20) CHECK (wastage_reason IN ('SPILLAGE', 'MOISTURE', 'PACKAGING', 'OTHER')),
  wastage_notes TEXT,
  notes TEXT,
  total_cost NUMERIC(15, 2) NOT NULL DEFAULT 0,
  status VARCHAR(10) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  out_adjustment_id UUID REFERENCES inventory_adjustments(id) ON DELETE SET NULL,
  in_adjustment_id UUID REFERENCES inventory_adjustments(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMP,
  UNIQUE (business_id, repack_number),
  CHECK (source_item_id <> packed_item_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_repacks_business_date ON stock_repacks(business_id, repack_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_repacks_source ON stock_repacks(source_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_repacks_packed ON stock_repacks(packed_item_id);

ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS repack_id UUID REFERENCES stock_repacks(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_repack ON inventory_adjustments(repack_id) WHERE repack_id IS NOT NULL;

ALTER TABLE inventory_adjustments DROP CONSTRAINT IF EXISTS inventory_adjustments_reason_code_check;
-- Keep every reason migrations 414 and 416 added (transit, custody, production): dropping them failed on
-- staging, where a transfer had been closed short as TRANSIT_LOSS.
ALTER TABLE inventory_adjustments ADD CONSTRAINT inventory_adjustments_reason_code_check CHECK (reason_code IN (
  'STOCK_TAKE', 'DAMAGE', 'THEFT', 'EXPIRED', 'FREE_SAMPLE',
  'COST_CORRECTION', 'LANDED_COST', 'REVALUATION', 'WRITE_DOWN',
  'REPACK_OUT', 'REPACK_IN',
  'PROCESS_LOSS', 'TRANSIT_LOSS', 'OWN_CONSUMPTION', 'CUSTODY_LOSS',
  'PRODUCTION_ISSUE', 'PRODUCTION_RECEIPT', 'BY_PRODUCT'
));
