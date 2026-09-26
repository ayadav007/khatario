-- Extra product photos, shopper favourites, and 1–5 ratings for the public store.

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS gallery_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN items.gallery_urls IS 'Extra storefront photos (JSON array of URLs). Cover remains items.image_url.';

CREATE TABLE IF NOT EXISTS store_item_favorites (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, customer_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_store_item_favorites_item
  ON store_item_favorites (business_id, item_id);

CREATE TABLE IF NOT EXISTS store_item_ratings (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, customer_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_store_item_ratings_item
  ON store_item_ratings (business_id, item_id);
