-- Alternate units for an item (a box of 12, a bag of 50 kg) and a log of duplicate items merged.

-- How many base units one alternate unit holds. A count can be entered in any of them; a box
-- barcode scanned during a count adds the whole box.
CREATE TABLE IF NOT EXISTS item_units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  unit VARCHAR(20) NOT NULL,
  factor_to_base DECIMAL(15,4) NOT NULL CHECK (factor_to_base > 0),
  barcode VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (item_id, unit)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_units_barcode ON item_units (business_id, barcode) WHERE barcode IS NOT NULL;

-- A duplicate item folded into the one that stays: every document and stock row now points at
-- the target; the source is soft-deleted.
CREATE TABLE IF NOT EXISTS item_merges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source_item_id UUID NOT NULL,
  source_name VARCHAR(300) NOT NULL,
  target_item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  moved JSONB NOT NULL DEFAULT '{}'::jsonb,
  merged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_item_merges_business ON item_merges (business_id, merged_at DESC);
