-- Store commerce: payments, customers, coupons, delivery partners, theme pages

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS store_allow_cod BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS store_delivery_provider VARCHAR(32) NOT NULL DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS store_theme JSONB,
  ADD COLUMN IF NOT EXISTS store_about_md TEXT,
  ADD COLUMN IF NOT EXISTS store_contact_md TEXT,
  ADD COLUMN IF NOT EXISTS store_shiprocket_email TEXT,
  ADD COLUMN IF NOT EXISTS store_shiprocket_password_enc TEXT,
  ADD COLUMN IF NOT EXISTS store_hide_khatario_badge BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(16) NOT NULL DEFAULT 'cod',
  ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(32),
  ADD COLUMN IF NOT EXISTS payment_ref TEXT,
  ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS store_customer_id UUID,
  ADD COLUMN IF NOT EXISTS delivery_provider VARCHAR(32) NOT NULL DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS shipment_id TEXT,
  ADD COLUMN IF NOT EXISTS awb TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS quoted_delivery_fee DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS billed_delivery_fee DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS customer_lat DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS customer_lng DECIMAL(10,7);

ALTER TABLE store_branch_delivery
  ADD COLUMN IF NOT EXISTS pickup_pincode VARCHAR(10),
  ADD COLUMN IF NOT EXISTS pickup_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS pickup_gstin VARCHAR(20);

ALTER TABLE store_orders DROP CONSTRAINT IF EXISTS store_orders_payment_status_check;
ALTER TABLE store_orders
  ADD CONSTRAINT store_orders_payment_status_check
  CHECK (payment_status IN ('unpaid', 'paid', 'cod'));

CREATE TABLE IF NOT EXISTS store_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone VARCHAR(20) NOT NULL,
  name VARCHAR(255),
  email VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, phone)
);

CREATE TABLE IF NOT EXISTS store_customer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  pincode VARCHAR(10),
  lat DECIMAL(10,7),
  lng DECIMAL(10,7),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_customer_otp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(8) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_store_customer_otp_phone
  ON store_customer_otp (business_id, phone, expires_at);

CREATE TABLE IF NOT EXISTS store_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code VARCHAR(64) NOT NULL,
  discount_type VARCHAR(16) NOT NULL DEFAULT 'percent'
    CHECK (discount_type IN ('percent', 'flat')),
  discount_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  min_order_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  usage_cap INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS store_coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES store_coupons(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id UUID REFERENCES store_orders(id) ON DELETE SET NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'razorpay',
  idempotency_key VARCHAR(255) NOT NULL,
  payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_store_orders_payment
  ON store_orders (business_id, payment_status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'store_orders_store_customer_id_fkey'
  ) THEN
    ALTER TABLE store_orders
      ADD CONSTRAINT store_orders_store_customer_id_fkey
      FOREIGN KEY (store_customer_id) REFERENCES store_customers(id) ON DELETE SET NULL;
  END IF;
END $$;
