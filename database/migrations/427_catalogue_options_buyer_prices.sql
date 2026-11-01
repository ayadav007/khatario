-- 427: Fuller Supplier Hub catalogue.
--   * supplier_listing_options: sizes, colours or packs of one listed item, each with its own
--     price (for example S 450, M 450, L 480). Catalog orders pick an option per line.
--   * supplier_buyer_prices: the supplier's own price for one connected buyer and item. It wins
--     over catalogue and list prices on orders and on the bill.
--   * supply_order_lines.unit_price / option_label: the price and option agreed when ordering.

CREATE TABLE IF NOT EXISTS supplier_listing_options (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID NOT NULL REFERENCES supplier_published_listings(id) ON DELETE CASCADE,
  label VARCHAR(60) NOT NULL CHECK (length(trim(label)) > 0),
  price NUMERIC(14, 2) CHECK (price IS NULL OR price >= 0),
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE (listing_id, label)
);

CREATE INDEX IF NOT EXISTS idx_supplier_listing_options_listing ON supplier_listing_options (listing_id, sort_order);

CREATE TABLE IF NOT EXISTS supplier_buyer_prices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  buyer_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  price NUMERIC(14, 2) NOT NULL CHECK (price >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (vendor_business_id, buyer_business_id, item_id),
  CONSTRAINT supplier_buyer_prices_pair_ne CHECK (vendor_business_id <> buyer_business_id)
);

ALTER TABLE supply_order_lines
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(14, 2) CHECK (unit_price IS NULL OR unit_price >= 0),
  ADD COLUMN IF NOT EXISTS option_label VARCHAR(60);

COMMENT ON COLUMN supply_order_lines.unit_price IS 'Price per supplier unit agreed when ordering (buyer price, option or catalogue price)';
COMMENT ON COLUMN supply_order_lines.option_label IS 'Size, colour or pack picked from the listing options';
