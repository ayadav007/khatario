-- Stock reconciliation, phase 1: where owned stock is, e-way bill records, and physical counts.
--
-- Custody: a movement out of the godown that keeps the goods ours (repair, job work, approval,
-- exhibition, consignment, demo) is tagged with custody_status and the party holding them. The
-- return comes back as an 'in' movement with the same tag, so the stock held by a party is
-- -SUM(signed qty) over its tagged movements. Untagged movements are ordinary godown stock.

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS custody_status VARCHAR(30)
    CHECK (custody_status IS NULL OR custody_status IN ('with_third_party')),
  ADD COLUMN IF NOT EXISTS custody_purpose VARCHAR(30)
    CHECK (custody_purpose IS NULL OR custody_purpose IN (
      'repair', 'job_work', 'approval', 'consignment', 'exhibition', 'demo', 'other'
    )),
  ADD COLUMN IF NOT EXISTS custody_party_type VARCHAR(20)
    CHECK (custody_party_type IS NULL OR custody_party_type IN ('customer', 'supplier')),
  ADD COLUMN IF NOT EXISTS custody_party_id UUID;

CREATE INDEX IF NOT EXISTS idx_stock_movements_custody
  ON stock_movements (business_id, custody_status, item_id)
  WHERE custody_status IS NOT NULL;

-- Challans: supply (paperwork, as before), returnable (goods go out and come back) or
-- non-returnable. Only returnable challans move stock, and only once they are sent.
ALTER TABLE delivery_challans
  ADD COLUMN IF NOT EXISTS challan_kind VARCHAR(20) NOT NULL DEFAULT 'supply'
    CHECK (challan_kind IN ('supply', 'returnable', 'non_returnable')),
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(30)
    CHECK (purpose IS NULL OR purpose IN (
      'repair', 'job_work', 'approval', 'consignment', 'exhibition', 'demo', 'other'
    )),
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expected_return_date DATE,
  ADD COLUMN IF NOT EXISTS stock_posted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS close_reason VARCHAR(20)
    CHECK (close_reason IS NULL OR close_reason IN ('returned', 'invoiced', 'written_off', 'mixed'));

ALTER TABLE delivery_challans DROP CONSTRAINT IF EXISTS check_challan_reference;
ALTER TABLE delivery_challans ADD CONSTRAINT check_challan_reference CHECK (
  invoice_id IS NOT NULL OR sales_order_id IS NOT NULL OR customer_id IS NOT NULL OR supplier_id IS NOT NULL
);

ALTER TABLE delivery_challans DROP CONSTRAINT IF EXISTS chk_returnable_challan_purpose;
ALTER TABLE delivery_challans ADD CONSTRAINT chk_returnable_challan_purpose CHECK (
  challan_kind <> 'returnable' OR purpose IS NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delivery_challans_open_returnable
  ON delivery_challans (business_id, expected_return_date)
  WHERE challan_kind = 'returnable' AND closed_at IS NULL;

ALTER TABLE delivery_challan_items
  ADD COLUMN IF NOT EXISTS qty_returned DECIMAL(15,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_invoiced DECIMAL(15,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_written_off DECIMAL(15,3) NOT NULL DEFAULT 0;

-- One row per e-way bill, linked to the document that moved the goods.
CREATE TABLE IF NOT EXISTS eway_bills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source_type VARCHAR(30) NOT NULL
    CHECK (source_type IN ('invoice', 'delivery_challan', 'stock_transfer', 'purchase', 'purchase_return', 'credit_note', 'other')),
  source_id UUID,
  direction VARCHAR(10) NOT NULL DEFAULT 'outward' CHECK (direction IN ('outward', 'inward')),
  ewb_number VARCHAR(12) NOT NULL CHECK (ewb_number ~ '^[0-9]{12}$'),
  doc_type VARCHAR(30) NOT NULL DEFAULT 'tax_invoice'
    CHECK (doc_type IN ('tax_invoice', 'bill_of_supply', 'delivery_challan', 'bill_of_entry', 'credit_note', 'others')),
  sub_supply_type VARCHAR(30) NOT NULL DEFAULT 'supply'
    CHECK (sub_supply_type IN (
      'supply', 'export', 'import', 'job_work', 'job_work_returns', 'skd_ckd', 'recipient_not_known',
      'own_use', 'exhibition', 'line_sales', 'sales_return', 'others'
    )),
  from_gstin VARCHAR(15),
  to_gstin VARCHAR(15),
  from_pincode VARCHAR(6),
  to_pincode VARCHAR(6),
  distance_km INTEGER NOT NULL CHECK (distance_km >= 0 AND distance_km <= 4000),
  is_odc BOOLEAN NOT NULL DEFAULT false,
  goods_value DECIMAL(15,2) NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'rejected', 'closed')),
  cancelled_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  extension_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, ewb_number)
);

CREATE INDEX IF NOT EXISTS idx_eway_bills_source ON eway_bills (business_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_eway_bills_active_expiry ON eway_bills (business_id, valid_until) WHERE status = 'active';

-- Part B: vehicle and transporter, newest row is current.
CREATE TABLE IF NOT EXISTS eway_bill_vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eway_bill_id UUID NOT NULL REFERENCES eway_bills(id) ON DELETE CASCADE,
  transport_mode VARCHAR(10) NOT NULL DEFAULT 'road' CHECK (transport_mode IN ('road', 'rail', 'air', 'ship')),
  vehicle_number VARCHAR(20),
  transporter_name VARCHAR(200),
  transporter_gstin VARCHAR(15),
  transport_doc_number VARCHAR(50),
  reason VARCHAR(100),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eway_bill_vehicles_bill ON eway_bill_vehicles (eway_bill_id, created_at DESC);

-- Physical count of one godown (warehouse mode) or one branch (branch stock). While a count is
-- open with freeze on, stock movements for that godown are refused (trigger below).
CREATE TABLE IF NOT EXISTS stock_counts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  count_number VARCHAR(40) NOT NULL,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
  count_date DATE NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'counting'
    CHECK (status IN ('counting', 'review', 'posted', 'cancelled')),
  freeze_stock BOOLEAN NOT NULL DEFAULT true,
  blind BOOLEAN NOT NULL DEFAULT true,
  recount_tolerance_pct DECIMAL(6,2) NOT NULL DEFAULT 2,
  recount_tolerance_value DECIMAL(15,2) NOT NULL DEFAULT 1000,
  write_off_approval_value DECIMAL(15,2) NOT NULL DEFAULT 10000,
  notes TEXT,
  opened_by UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, count_number)
);

CREATE INDEX IF NOT EXISTS idx_stock_counts_open
  ON stock_counts (business_id, warehouse_id)
  WHERE status IN ('counting', 'review');

-- Book quantities are captured when the count opens. physical_qty is what is on the shelf and
-- ours; third_party_qty is what is on the shelf but belongs to someone else (not in physical_qty).
CREATE TABLE IF NOT EXISTS stock_count_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  count_id UUID NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  godown_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
  with_third_party_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
  in_transit_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
  unit_cost DECIMAL(15,4) NOT NULL DEFAULT 0,
  physical_qty DECIMAL(15,3),
  third_party_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
  first_count_qty DECIMAL(15,3),
  recount_required BOOLEAN NOT NULL DEFAULT false,
  recounted BOOLEAN NOT NULL DEFAULT false,
  reason_code VARCHAR(30),
  reason_notes TEXT,
  counted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  counted_at TIMESTAMPTZ,
  adjustment_id UUID REFERENCES inventory_adjustments(id) ON DELETE SET NULL,
  UNIQUE (count_id, item_id)
);

-- New write-off reasons, and the count an adjustment came from.
DO $$
BEGIN
  -- Re-running this migration after a later one must not drop the values that one added.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'inventory_adjustments'::regclass AND conname = 'inventory_adjustments_reason_code_check' AND pg_get_constraintdef(oid) LIKE '%CUSTODY_LOSS%'
  ) THEN
    ALTER TABLE inventory_adjustments DROP CONSTRAINT IF EXISTS inventory_adjustments_reason_code_check;
    ALTER TABLE inventory_adjustments ADD CONSTRAINT inventory_adjustments_reason_code_check CHECK (
      reason_code IN (
        'STOCK_TAKE', 'DAMAGE', 'THEFT', 'EXPIRED', 'FREE_SAMPLE', 'COST_CORRECTION', 'LANDED_COST',
        'REVALUATION', 'WRITE_DOWN', 'REPACK_OUT', 'REPACK_IN',
        'PROCESS_LOSS', 'TRANSIT_LOSS', 'OWN_CONSUMPTION', 'CUSTODY_LOSS'
      )
    );
  END IF;
END $$;
ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS stock_count_id UUID REFERENCES stock_counts(id) ON DELETE SET NULL;

-- Refuse stock movements into or out of a godown being counted. The count's own posting sets
-- khatario.stock_count_id for its transaction and passes. A branch-mode count (no warehouse)
-- freezes movements with no warehouse for the business.
CREATE OR REPLACE FUNCTION refuse_movement_during_stock_count() RETURNS trigger AS $$
DECLARE
  posting TEXT := current_setting('khatario.stock_count_id', true);
  blocking RECORD;
BEGIN
  SELECT sc.id, sc.count_number INTO blocking
    FROM stock_counts sc
   WHERE sc.business_id = NEW.business_id
     AND sc.freeze_stock
     AND sc.status IN ('counting', 'review')
     AND (sc.id::text IS DISTINCT FROM posting)
     AND (
       (sc.warehouse_id IS NOT NULL AND sc.warehouse_id = NEW.location_id)
       OR (sc.warehouse_id IS NULL AND NEW.location_id IS NULL)
     )
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'STOCK_FROZEN: Stock count % is open for this godown. Finish or cancel it first.', blocking.count_number
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refuse_movement_during_stock_count ON stock_movements;
CREATE TRIGGER trg_refuse_movement_during_stock_count
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION refuse_movement_during_stock_count();
