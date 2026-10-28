-- Migration 434: Price levels, quantity slabs, date ranges, customer discounts and price history
-- Description: Brings party-wise pricing up to what traders expect from Tally/Busy/Vyapar.
--   * A customer price can be a fixed price or a discount %, and can have a start and end date.
--   * Price levels (Wholesale, Retail, Dealer...) hold rates per item or variant, with quantity
--     slabs and dates. A customer is put on one price level.
--   * A customer can get a discount % on a whole category.
--   * Every change to these rates is logged.
--   * Supplier Hub buyer prices move into party_item_prices, so a connected buyer has one list.
-- The bill picks, in order: price typed by hand, customer price, customer's price level,
-- item's own price. A discount (customer item, then customer category, then level) applies to
-- the price picked when the matching rule has no fixed price.
-- Created: 2026-10-28

-- 1. Customer prices: discount % instead of (or alongside) a price, and a date range.
ALTER TABLE party_item_prices
  ALTER COLUMN price DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS valid_from DATE,
  ADD COLUMN IF NOT EXISTS valid_to DATE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE party_item_prices DROP CONSTRAINT IF EXISTS party_item_prices_price_or_discount;
ALTER TABLE party_item_prices ADD CONSTRAINT party_item_prices_price_or_discount
  CHECK (
    (price IS NOT NULL OR discount_percent IS NOT NULL)
    AND (price IS NULL OR price >= 0)
    AND (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100))
    AND (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
  );

-- 2. Price levels and their rates.
CREATE TABLE IF NOT EXISTS price_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS price_levels_business_name_unique
  ON price_levels (business_id, LOWER(name));

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS price_level_id UUID REFERENCES price_levels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customers_price_level ON customers (price_level_id) WHERE price_level_id IS NOT NULL;

-- One row per level, item (or variant), quantity slab and start date. min_qty 0 is the base rate;
-- a row with min_qty 10 applies from 10 units up.
CREATE TABLE IF NOT EXISTS price_level_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  price_level_id UUID NOT NULL REFERENCES price_levels(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES item_variants(id) ON DELETE CASCADE,
  min_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  price NUMERIC(12, 2) CHECK (price IS NULL OR price >= 0),
  discount_percent NUMERIC(5, 2) CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100)),
  valid_from DATE,
  valid_to DATE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT price_level_rates_price_or_discount CHECK (price IS NOT NULL OR discount_percent IS NOT NULL),
  CONSTRAINT price_level_rates_dates CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);
CREATE UNIQUE INDEX IF NOT EXISTS price_level_rates_unique
  ON price_level_rates (
    price_level_id, item_id,
    COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    min_qty,
    COALESCE(valid_from, DATE '1900-01-01')
  );
CREATE INDEX IF NOT EXISTS idx_price_level_rates_item ON price_level_rates (item_id);

-- 3. Customer discount on a whole category (a brand or product group).
CREATE TABLE IF NOT EXISTS party_category_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  discount_percent NUMERIC(5, 2) NOT NULL CHECK (discount_percent >= 0 AND discount_percent <= 100),
  valid_from DATE,
  valid_to DATE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT party_category_discounts_unique UNIQUE (business_id, party_id, category_id),
  CONSTRAINT party_category_discounts_dates CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);

-- 4. History of every change to a customer price, level rate or category discount.
CREATE TABLE IF NOT EXISTS price_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  scope VARCHAR(20) NOT NULL CHECK (scope IN ('party_item', 'price_level', 'party_category')),
  party_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  price_level_id UUID REFERENCES price_levels(id) ON DELETE CASCADE,
  item_id UUID REFERENCES items(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES item_variants(id) ON DELETE SET NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  min_qty NUMERIC(14, 3),
  old_price NUMERIC(12, 2),
  new_price NUMERIC(12, 2),
  old_discount_percent NUMERIC(5, 2),
  new_discount_percent NUMERIC(5, 2),
  valid_from DATE,
  valid_to DATE,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_price_change_log_party ON price_change_log (business_id, party_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_change_log_item ON price_change_log (business_id, item_id, changed_at DESC);

-- 5. Supplier Hub buyer prices become the linked customer's price. Existing customer prices win.
INSERT INTO party_item_prices (business_id, party_id, item_id, price)
SELECT DISTINCT ON (bp.vendor_business_id, c.id, bp.item_id)
       bp.vendor_business_id, c.id, bp.item_id, bp.price
  FROM supplier_buyer_prices bp
  JOIN customers c
    ON c.business_id = bp.vendor_business_id
   AND c.linked_business_id = bp.buyer_business_id
   AND c.deleted_at IS NULL
 ORDER BY bp.vendor_business_id, c.id, bp.item_id, bp.updated_at DESC
ON CONFLICT (business_id, party_id, item_id) WHERE variant_id IS NULL DO NOTHING;

COMMENT ON TABLE supplier_buyer_prices IS
  'Retired by migration 434: connected-buyer prices now live in party_item_prices for the linked customer. Kept for history only.';
