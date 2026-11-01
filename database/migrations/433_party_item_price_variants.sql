-- Migration 433: Party item prices per variant
-- Description: A customer price can be set for one variant of an item (size, colour). A row with
-- no variant still covers the whole item and is used for any variant without its own row.
-- Created: 2026-10-28

ALTER TABLE party_item_prices
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES item_variants(id) ON DELETE CASCADE;

ALTER TABLE party_item_prices
  DROP CONSTRAINT IF EXISTS party_item_prices_business_party_item_unique;

CREATE UNIQUE INDEX IF NOT EXISTS party_item_prices_item_unique
  ON party_item_prices (business_id, party_id, item_id)
  WHERE variant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS party_item_prices_variant_unique
  ON party_item_prices (business_id, party_id, item_id, variant_id)
  WHERE variant_id IS NOT NULL;

COMMENT ON TABLE party_item_prices IS
  'Per-party (customer) selling price for an item, or for one variant of it. A row without variant_id covers every variant that has no row of its own.';

COMMENT ON COLUMN party_item_prices.variant_id IS
  'Variant this price is for; NULL means the whole item.';
