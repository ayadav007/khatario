-- Opening promo / advertisement bottom sheet, configured from the merchant portal.

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS store_promo_sheet JSONB;
