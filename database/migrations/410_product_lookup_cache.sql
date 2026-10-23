-- Scan & Add Items: what the outside product databases (ProductGuru, Open Facts) said about a barcode.
-- Per business, so one shop's scans and their timing are never visible to another shop.
-- A "not found" answer is kept too, so a barcode no database knows is not asked about on every scan.

CREATE TABLE IF NOT EXISTS product_lookup_cache (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  barcode VARCHAR(100) NOT NULL,
  -- 'found' | 'not_found'. Provider errors are not cached.
  status VARCHAR(20) NOT NULL CHECK (status IN ('found', 'not_found')),
  -- Normalised suggestions, one per provider that knew the barcode, with source URL and licence.
  suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, barcode)
);

-- Where an item's details came from when the shopkeeper accepted a database suggestion:
-- { provider, source_url, license, attribution, fetched_at }. Set by the server from the cache above,
-- never from what the client sends. Null for items typed in by hand.
ALTER TABLE items ADD COLUMN IF NOT EXISTS external_source JSONB;
