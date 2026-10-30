-- Migration 448: Store product page fields and shopper reviews
-- Description: Phase 2 (product page) adds an optional product video, up to four extra info tabs and a
--   size chart to items, plus a category-level size chart that items fall back to. Phase 3 adds
--   store_item_reviews: one review per shopper per item, with optional photos, a publish/pending/hidden
--   status for moderation, and a merchant reply. Reviews also write store_item_ratings (migration 285)
--   so product cards and the rating sort keep working.
--   Spec: docs/superpowers/specs/2026-10-29-store-shopping-features-design.md (sections 5.1 and 6.1)
-- Created: 2026-10-30

-- Product page fields
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS store_tabs JSONB NOT NULL DEFAULT '[]',   -- [{title, body}] up to 4
  ADD COLUMN IF NOT EXISTS size_chart JSONB;                          -- {columns:[], rows:[[]]} or null

ALTER TABLE categories ADD COLUMN IF NOT EXISTS size_chart JSONB;

-- Shopper reviews
CREATE TABLE IF NOT EXISTS store_item_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  order_id UUID REFERENCES store_orders(id) ON DELETE SET NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title VARCHAR(120),
  body TEXT NOT NULL,
  photos JSONB NOT NULL DEFAULT '[]',          -- up to 4 URLs
  status VARCHAR(10) NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'pending', 'hidden')),
  merchant_reply TEXT,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, customer_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_store_item_reviews_item
  ON store_item_reviews (business_id, item_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_item_reviews_status
  ON store_item_reviews (business_id, status, created_at DESC);
