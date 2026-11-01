-- Stock reconciliation, phase 2: goods in transit from suppliers, free quantity on purchases,
-- transfer shortfalls, job-work deadlines and GST registration of godowns.

-- Goods billed by a supplier but not yet in the godown: the bill posts stock as before, then an
-- 'out' movement tagged in_transit (purpose 'inward') takes it off the godown until it is received.
DO $$
BEGIN
  -- Re-running this migration after a later one must not drop the values that one added.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'stock_movements'::regclass AND conname = 'stock_movements_custody_status_check' AND pg_get_constraintdef(oid) LIKE '%in_transit%'
  ) THEN
    ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_custody_status_check;
    ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_custody_status_check
      CHECK (custody_status IS NULL OR custody_status IN ('with_third_party', 'in_transit'));
  END IF;
END $$;
DO $$
BEGIN
  -- Re-running this migration after a later one must not drop the values that one added.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'stock_movements'::regclass AND conname = 'stock_movements_custody_purpose_check' AND pg_get_constraintdef(oid) LIKE '%inward%'
  ) THEN
    ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_custody_purpose_check;
    ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_custody_purpose_check
      CHECK (custody_purpose IS NULL OR custody_purpose IN (
        'repair', 'job_work', 'approval', 'consignment', 'exhibition', 'demo', 'other', 'inward'
      ));
  END IF;
END $$;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS goods_status VARCHAR(20) NOT NULL DEFAULT 'received'
    CHECK (goods_status IN ('received', 'in_transit', 'partial'));

-- Free goods under a supplier scheme ("buy 10, get 1"): added to stock at no cost.
ALTER TABLE purchase_items
  ADD COLUMN IF NOT EXISTS free_qty DECIMAL(15,3) NOT NULL DEFAULT 0 CHECK (free_qty >= 0),
  ADD COLUMN IF NOT EXISTS qty_received DECIMAL(15,3);

-- A transfer that arrives short is closed by writing the shortfall off (transit loss) or by
-- claiming it from the carrier.
ALTER TABLE stock_transfer_items
  ADD COLUMN IF NOT EXISTS qty_short DECIMAL(15,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS short_reason VARCHAR(20)
    CHECK (short_reason IS NULL OR short_reason IN ('transit_loss', 'carrier_claim')),
  ADD COLUMN IF NOT EXISTS claim_party VARCHAR(200),
  ADD COLUMN IF NOT EXISTS claim_amount DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS short_adjustment_id UUID REFERENCES inventory_adjustments(id) ON DELETE SET NULL;

-- Job work (s.143): inputs come back within 1 year, capital goods within 3.
ALTER TABLE delivery_challans
  ADD COLUMN IF NOT EXISTS job_work_goods VARCHAR(20)
    CHECK (job_work_goods IS NULL OR job_work_goods IN ('inputs', 'capital_goods'));

-- Each godown is a principal or additional place of business on the GST registration.
ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS gst_place_type VARCHAR(20)
    CHECK (gst_place_type IS NULL OR gst_place_type IN ('principal', 'additional', 'not_registered')),
  ADD COLUMN IF NOT EXISTS gstin VARCHAR(15);

-- Each settlement of a returnable challan line, with its own date (ITC-04 table 5 needs the
-- date goods came back from the job worker).
CREATE TABLE IF NOT EXISTS delivery_challan_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  delivery_challan_id UUID NOT NULL REFERENCES delivery_challans(id) ON DELETE CASCADE,
  challan_item_id UUID NOT NULL REFERENCES delivery_challan_items(id) ON DELETE CASCADE,
  return_date DATE NOT NULL,
  qty_returned DECIMAL(15,3) NOT NULL DEFAULT 0,
  qty_invoiced DECIMAL(15,3) NOT NULL DEFAULT 0,
  qty_written_off DECIMAL(15,3) NOT NULL DEFAULT 0,
  adjustment_id UUID REFERENCES inventory_adjustments(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_delivery_challan_returns_challan ON delivery_challan_returns (delivery_challan_id, return_date);
