-- Supplier Hub phase 2: remembered item matches between a buyer and a linked supplier.
-- One row says "supplier B's item X is buyer A's item Y, and one X is N of Y" (for example a
-- carton of 144 against single packs). Filled from request mappings and bill conversions, and
-- used to turn the supplier's invoice lines into the buyer's purchase lines.

CREATE TABLE IF NOT EXISTS supplier_item_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buyer_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vendor_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  buyer_item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  vendor_item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  buyer_units_per_vendor_unit NUMERIC(14, 4) NOT NULL DEFAULT 1
    CHECK (buyer_units_per_vendor_unit > 0),
  source VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'request', 'conversion')),
  last_rate NUMERIC(14, 4),
  last_used_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT supplier_item_links_pair_ne CHECK (buyer_business_id <> vendor_business_id)
);

-- Each supplier item maps to one buyer item for that buyer.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_supplier_item_links_vendor_item
  ON supplier_item_links (buyer_business_id, vendor_business_id, vendor_item_id);

CREATE INDEX IF NOT EXISTS idx_supplier_item_links_buyer_item
  ON supplier_item_links (buyer_business_id, buyer_item_id);

COMMENT ON TABLE supplier_item_links IS
  'Supplier Hub item map: vendor item -> buyer item with unit conversion (buyer units per vendor unit)';

-- Both items must belong to the businesses the row names.
CREATE OR REPLACE FUNCTION trg_supplier_item_links_validate()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM items WHERE id = NEW.buyer_item_id AND business_id = NEW.buyer_business_id) THEN
    RAISE EXCEPTION 'supplier_item_links: buyer_item_id must belong to buyer_business_id' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM items WHERE id = NEW.vendor_item_id AND business_id = NEW.vendor_business_id) THEN
    RAISE EXCEPTION 'supplier_item_links: vendor_item_id must belong to vendor_business_id' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_item_links_validate ON supplier_item_links;
CREATE TRIGGER trg_supplier_item_links_validate
  BEFORE INSERT OR UPDATE ON supplier_item_links
  FOR EACH ROW
  EXECUTE FUNCTION trg_supplier_item_links_validate();

-- Seed from requests where the supplier already picked its item (one per supplier item).
INSERT INTO supplier_item_links (
  buyer_business_id, vendor_business_id, buyer_item_id, vendor_item_id, source
)
SELECT DISTINCT ON (bi.business_id, vi.business_id, vi.id)
  bi.business_id, vi.business_id, bi.id, vi.id, 'request'
FROM quantity_requests qr
JOIN items bi ON bi.id = qr.item_id AND bi.deleted_at IS NULL
JOIN items vi ON vi.id = qr.responder_item_id AND vi.deleted_at IS NULL
WHERE qr.responder_item_id IS NOT NULL
  AND bi.business_id <> vi.business_id
ORDER BY bi.business_id, vi.business_id, vi.id, qr.updated_at DESC
ON CONFLICT (buyer_business_id, vendor_business_id, vendor_item_id) DO NOTHING;
