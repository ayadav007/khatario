-- Top bar promotion: image strip between date controls and right cluster
ALTER TABLE platform_promotions
  ADD COLUMN IF NOT EXISTS topbar_mode VARCHAR(32) DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS topbar_image_urls JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS topbar_carousel_interval_ms INTEGER DEFAULT 5000;

COMMENT ON COLUMN platform_promotions.topbar_mode IS 'single = one image; vertical_carousel = cycle images with vertical (bottom-to-top) transition';
COMMENT ON COLUMN platform_promotions.topbar_image_urls IS 'JSON array of image URLs; used for topbar and especially vertical_carousel';
COMMENT ON COLUMN platform_promotions.topbar_carousel_interval_ms IS 'Delay between vertical carousel slides';
