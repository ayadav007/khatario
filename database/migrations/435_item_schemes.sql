-- Migration 435: Quantity schemes ("buy 10, get 1 free")
-- Description: A scheme on an item (or one variant) gives free units for every `buy_qty` billed.
-- It can be for everyone or for one price level, and can have dates. The bill adds the free units
-- as their own line at no charge, so stock goes down by them and no GST is charged on them.
-- Created: 2026-10-28

CREATE TABLE IF NOT EXISTS item_schemes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES item_variants(id) ON DELETE CASCADE,
  price_level_id UUID REFERENCES price_levels(id) ON DELETE CASCADE,
  buy_qty NUMERIC(14, 3) NOT NULL CHECK (buy_qty > 0),
  free_qty NUMERIC(14, 3) NOT NULL CHECK (free_qty > 0),
  valid_from DATE,
  valid_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT item_schemes_dates CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);
CREATE INDEX IF NOT EXISTS idx_item_schemes_item ON item_schemes (business_id, item_id) WHERE is_active;
