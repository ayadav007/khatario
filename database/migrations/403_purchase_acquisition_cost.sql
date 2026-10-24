-- Purchase freight classification and acquisition cost.
-- Historical purchase lines keep acquisition_cost NULL and continue to use taxable_value.
-- No posted voucher, stock movement, or supplier balance is rewritten.

ALTER TABLE purchase_items
  ADD COLUMN IF NOT EXISTS acquisition_cost NUMERIC(15,2);

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS acquisition_costs_capitalized BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL;

COMMENT ON COLUMN purchase_items.acquisition_cost IS
  'Complete non-recoverable cost of this line, including allocated incidental charges and blocked GST. NULL on historical lines: costing uses taxable_value.';
COMMENT ON COLUMN purchases.acquisition_costs_capitalized IS
  'True only when a new perpetual bill capitalized an incidental charge into stock or capital goods. Historical bills stay false.';

CREATE TABLE IF NOT EXISTS purchase_charges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  purpose TEXT,
  classification TEXT NOT NULL CHECK (classification IN ('incidental_to_goods', 'independent_service')),
  hsn_sac VARCHAR(10),
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  taxable_value NUMERIC(15,2) NOT NULL,
  cgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  sgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_purchase_charges_purchase ON purchase_charges (purchase_id);

CREATE TABLE IF NOT EXISTS purchase_charge_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  purchase_charge_id UUID NOT NULL REFERENCES purchase_charges(id) ON DELETE CASCADE,
  purchase_item_id UUID NOT NULL REFERENCES purchase_items(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  UNIQUE (purchase_charge_id, purchase_item_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_charge_allocations_item ON purchase_charge_allocations (purchase_item_id);

CREATE TABLE IF NOT EXISTS acquisition_cost_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  purchase_item_id UUID NOT NULL REFERENCES purchase_items(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('landed_cost_adjustment')),
  source_id UUID NOT NULL,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  reversed_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (reversed_amount >= 0),
  consumed_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (consumed_amount >= 0),
  open_qty NUMERIC(15,3) NOT NULL CHECK (open_qty > 0),
  CHECK (reversed_amount + consumed_amount <= amount + 0.001),
  UNIQUE (business_id, source_type, source_id, purchase_item_id)
);

CREATE INDEX IF NOT EXISTS idx_acquisition_cost_applications_purchase
  ON acquisition_cost_applications (purchase_id);

COMMENT ON TABLE purchase_charge_allocations IS
  'Authoritative split of a supplier incidental charge. Not a second capitalization.';
COMMENT ON TABLE acquisition_cost_applications IS
  'Later Landed Cost adjustments against freight that is still expensed. Does not change purchase_items.acquisition_cost.';
