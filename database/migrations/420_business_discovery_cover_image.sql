-- 420: Cover photo for a supplier's Supplier Hub profile (shop front or warehouse).
-- The logo stays on businesses.logo_url, shared with invoices; the cover belongs to the
-- directory listing only. Stored like other uploads (data URL from /api/upload/image).

ALTER TABLE business_discovery
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

COMMENT ON COLUMN business_discovery.cover_image_url IS
  'Supplier Hub profile cover photo; NULL shows the tinted pattern';
