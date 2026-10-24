-- Supplier Hub phase 6: richer catalog, collections and the new-arrival push.
-- A supplier groups new designs into a collection and publishes it once; every connected buyer
-- who has not muted the supplier's launches gets one notification, sees it in New arrivals and
-- can order from it (a catalog order, see supply_orders.origin = 'catalog').

CREATE TABLE IF NOT EXISTS supplier_collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  season VARCHAR(60),
  description TEXT,
  cover_image_url TEXT,
  audience VARCHAR(20) NOT NULL DEFAULT 'linked_only'
    CHECK (audience IN ('linked_only', 'public_preview')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_collections_supplier
  ON supplier_collections (supplier_business_id, status, published_at DESC);

ALTER TABLE supplier_published_listings
  ADD COLUMN IF NOT EXISTS collection_id UUID REFERENCES supplier_collections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS price NUMERIC(14, 2) CHECK (price IS NULL OR price >= 0),
  ADD COLUMN IF NOT EXISTS pack_label VARCHAR(80),
  ADD COLUMN IF NOT EXISTS order_multiple NUMERIC(14, 4) CHECK (order_multiple IS NULL OR order_multiple > 0);

COMMENT ON COLUMN supplier_published_listings.price IS
  'Price per unit shown to connected buyers (public visitors still see price_display / from_amount)';
COMMENT ON COLUMN supplier_published_listings.pack_label IS
  'How it is sold, for example "Set of 4: S, M, L, XL"';
COMMENT ON COLUMN supplier_published_listings.order_multiple IS
  'Catalog orders must be a multiple of this quantity (for example 4 for a size set)';

CREATE INDEX IF NOT EXISTS idx_supplier_published_collection
  ON supplier_published_listings (collection_id) WHERE collection_id IS NOT NULL;

-- The buyer's switch to stop launch notifications from one supplier.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS mute_launches BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN suppliers.mute_launches IS
  'Buyer does not want new-collection notifications from this linked supplier';
