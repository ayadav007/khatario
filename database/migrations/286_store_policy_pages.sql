-- Merchant legal copy for the public store footer.

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS store_privacy_md TEXT,
  ADD COLUMN IF NOT EXISTS store_refund_md TEXT,
  ADD COLUMN IF NOT EXISTS store_terms_md TEXT;
