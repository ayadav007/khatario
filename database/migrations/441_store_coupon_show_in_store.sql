-- Coupons the merchant chooses to advertise in the storefront cart (Quick theme offers list).
-- Off by default so existing private codes are never listed.
ALTER TABLE store_coupons
  ADD COLUMN IF NOT EXISTS show_in_store BOOLEAN NOT NULL DEFAULT false;
