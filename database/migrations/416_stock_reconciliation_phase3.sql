-- Stock reconciliation, phase 3: stock held in the godown but not usable, other people's goods
-- in our godown, import transit stages, insurance claims and manufacturing.

-- Held stock stays in the godown (and in a physical count) but cannot be sold until released.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_custody_status_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_custody_status_check
  CHECK (custody_status IS NULL OR custody_status IN ('with_third_party', 'in_transit', 'held'));
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_custody_purpose_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_custody_purpose_check
  CHECK (custody_purpose IS NULL OR custody_purpose IN (
    'repair', 'job_work', 'approval', 'consignment', 'exhibition', 'demo', 'other', 'inward',
    'quarantine', 'qc_hold', 'damaged', 'return_inspection'
  ));

CREATE TABLE IF NOT EXISTS stock_holds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  hold_number VARCHAR(40) NOT NULL,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('quarantine', 'qc_hold', 'damaged', 'return_inspection')),
  hold_date DATE NOT NULL,
  qty DECIMAL(15,3) NOT NULL CHECK (qty > 0),
  qty_released DECIMAL(15,3) NOT NULL DEFAULT 0,
  qty_written_off DECIMAL(15,3) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  reference VARCHAR(100),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ,
  UNIQUE (business_id, hold_number)
);
CREATE INDEX IF NOT EXISTS idx_stock_holds_open ON stock_holds (business_id, warehouse_id) WHERE status = 'open';

-- Goods in our godown that belong to someone else (customer goods in for repair, goods kept for
-- others). Never part of our stock; a count leaves them out.
CREATE TABLE IF NOT EXISTS inward_custody (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
  owner_type VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (owner_type IN ('customer', 'supplier', 'other')),
  owner_id UUID,
  owner_name VARCHAR(200) NOT NULL,
  item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  description VARCHAR(300) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'PCS',
  qty DECIMAL(15,3) NOT NULL CHECK (qty > 0),
  qty_returned DECIMAL(15,3) NOT NULL DEFAULT 0,
  received_date DATE NOT NULL,
  reason VARCHAR(30) NOT NULL DEFAULT 'repair' CHECK (reason IN ('repair', 'job_work', 'storage', 'sold_not_collected', 'other')),
  reference VARCHAR(100),
  returned_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'returned')),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inward_custody_held ON inward_custody (business_id, warehouse_id) WHERE status = 'held';

ALTER TABLE stock_count_lines
  ADD COLUMN IF NOT EXISTS held_qty DECIMAL(15,3) NOT NULL DEFAULT 0;

-- Where imported (or long-haul) goods are while in transit, and the bill of entry.
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS transit_stage VARCHAR(20)
    CHECK (transit_stage IS NULL OR transit_stage IN ('dispatched', 'at_sea', 'at_port', 'at_customs', 'bonded_warehouse', 'on_road')),
  ADD COLUMN IF NOT EXISTS bill_of_entry_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS bill_of_entry_date DATE;

-- Insurance claim against stock lost or damaged (theft, fire, flood, transit).
CREATE TABLE IF NOT EXISTS insurance_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  claim_number VARCHAR(40) NOT NULL,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  loss_date DATE NOT NULL,
  cause VARCHAR(20) NOT NULL CHECK (cause IN ('theft', 'fire', 'flood', 'transit', 'damage', 'other')),
  insurer VARCHAR(200) NOT NULL,
  policy_number VARCHAR(100),
  fir_number VARCHAR(100),
  fir_date DATE,
  surveyor VARCHAR(200),
  loss_value DECIMAL(15,2) NOT NULL DEFAULT 0,
  claimed_amount DECIMAL(15,2) NOT NULL CHECK (claimed_amount >= 0),
  admitted_amount DECIMAL(15,2),
  settled_amount DECIMAL(15,2),
  status VARCHAR(20) NOT NULL DEFAULT 'lodged' CHECK (status IN ('lodged', 'admitted', 'settled', 'rejected')),
  admitted_on DATE,
  settled_on DATE,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, claim_number)
);
CREATE TABLE IF NOT EXISTS insurance_claim_adjustments (
  claim_id UUID NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,
  adjustment_id UUID NOT NULL REFERENCES inventory_adjustments(id) ON DELETE CASCADE,
  PRIMARY KEY (claim_id, adjustment_id)
);

INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
SELECT b.id, '1145', 'Insurance Claims Receivable', 'asset', g.id, 'debit', true, 45
  FROM businesses b
  JOIN account_groups g ON g.business_id = b.id AND g.group_code = '1100'
 WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '1145');

-- Manufacturing: a bill of materials says what one batch of an item consumes and yields;
-- a production entry consumes inputs into work in progress and receives the output at that cost.
CREATE TABLE IF NOT EXISTS boms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  output_item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  output_qty DECIMAL(15,3) NOT NULL CHECK (output_qty > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bom_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bom_id UUID NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'input' CHECK (role IN ('input', 'byproduct', 'scrap')),
  qty DECIMAL(15,3) NOT NULL CHECK (qty > 0),
  -- By-products and scrap are valued at what they will fetch; that value comes off the output's cost.
  recovery_rate DECIMAL(15,4) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS production_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  entry_number VARCHAR(40) NOT NULL,
  entry_date DATE NOT NULL,
  bom_id UUID REFERENCES boms(id) ON DELETE SET NULL,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
  output_item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  output_qty DECIMAL(15,3) NOT NULL CHECK (output_qty > 0),
  input_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
  recovery_value DECIMAL(15,2) NOT NULL DEFAULT 0,
  output_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, entry_number)
);
CREATE TABLE IF NOT EXISTS production_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  production_id UUID NOT NULL REFERENCES production_entries(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  role VARCHAR(20) NOT NULL CHECK (role IN ('input', 'output', 'byproduct', 'scrap')),
  qty DECIMAL(15,3) NOT NULL CHECK (qty > 0),
  value DECIMAL(15,2) NOT NULL DEFAULT 0,
  adjustment_id UUID REFERENCES inventory_adjustments(id) ON DELETE SET NULL
);

ALTER TABLE inventory_adjustments DROP CONSTRAINT IF EXISTS inventory_adjustments_reason_code_check;
ALTER TABLE inventory_adjustments ADD CONSTRAINT inventory_adjustments_reason_code_check CHECK (
  reason_code IN (
    'STOCK_TAKE', 'DAMAGE', 'THEFT', 'EXPIRED', 'FREE_SAMPLE', 'COST_CORRECTION', 'LANDED_COST',
    'REVALUATION', 'WRITE_DOWN', 'REPACK_OUT', 'REPACK_IN',
    'PROCESS_LOSS', 'TRANSIT_LOSS', 'OWN_CONSUMPTION', 'CUSTODY_LOSS',
    'PRODUCTION_ISSUE', 'PRODUCTION_RECEIPT', 'BY_PRODUCT'
  )
);
