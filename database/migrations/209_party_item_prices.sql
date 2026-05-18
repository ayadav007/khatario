-- Migration 209: Party-specific item pricing
-- Description: Optional per-customer (party) price overrides for items within a business.
-- Created: 2026-04-28

CREATE TABLE IF NOT EXISTS party_item_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  price NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT party_item_prices_business_party_item_unique UNIQUE (business_id, party_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_party_item_prices_party_id ON party_item_prices(party_id);
CREATE INDEX IF NOT EXISTS idx_party_item_prices_item_id ON party_item_prices(item_id);

COMMENT ON TABLE party_item_prices IS
  'Per-party (customer) selling price for an item; one row per (business, customer, item).';

COMMENT ON COLUMN party_item_prices.party_id IS
  'Customer (parties are modeled as customers in this schema).';
