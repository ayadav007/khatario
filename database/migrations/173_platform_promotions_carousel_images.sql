-- Optional multiple images for a single message_type=carousel row (one promotion, many art slides; same copy/CTA/colors)
ALTER TABLE platform_promotions
  ADD COLUMN IF NOT EXISTS carousel_image_urls JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS carousel_advance_ms INTEGER DEFAULT 6000;

COMMENT ON COLUMN platform_promotions.carousel_image_urls IS '2+ image URLs: dashboard carousel rotates through these (same title/CTA). Empty = use image_url only';
COMMENT ON COLUMN platform_promotions.carousel_advance_ms IS 'Auto-advance between slides in ms (dashboard carousel)';
