-- Online store: subdomain-based storefront per business
-- Each business gets {subdomain}.khatario.com

-- Store subdomain + enable flag on business_settings
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS store_subdomain VARCHAR(63) UNIQUE,
  ADD COLUMN IF NOT EXISTS store_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS store_tagline TEXT,
  ADD COLUMN IF NOT EXISTS store_hero_image_url TEXT,
  ADD COLUMN IF NOT EXISTS store_min_order_amount DECIMAL(12,2) DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_settings_store_subdomain
  ON business_settings (store_subdomain) WHERE store_subdomain IS NOT NULL;

-- Per-item flag: opt-in to show in public store
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS show_in_store BOOLEAN NOT NULL DEFAULT false;

-- Per-branch delivery zone settings
CREATE TABLE IF NOT EXISTS store_branch_delivery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  location_lat DECIMAL(10,7),
  location_lng DECIMAL(10,7),
  location_address TEXT,
  delivery_mode VARCHAR(20) NOT NULL DEFAULT 'radius'
    CHECK (delivery_mode IN ('radius', 'pincode', 'all_india')),
  delivery_radius_km INTEGER DEFAULT 10,
  serviceable_pincodes TEXT[] DEFAULT '{}',
  allow_pickup BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, branch_id)
);

-- Delivery charge tiers per branch
CREATE TABLE IF NOT EXISTS store_delivery_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_delivery_id UUID NOT NULL REFERENCES store_branch_delivery(id) ON DELETE CASCADE,
  min_distance_km INTEGER NOT NULL DEFAULT 0,
  max_distance_km INTEGER,
  charge DECIMAL(10,2) NOT NULL DEFAULT 0,
  free_above_amount DECIMAL(12,2),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (branch_delivery_id, sort_order)
);

-- Store orders
CREATE TABLE IF NOT EXISTS store_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  order_number VARCHAR(20) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  customer_email VARCHAR(255),
  customer_address TEXT,
  customer_pincode VARCHAR(10),
  customer_lat DECIMAL(10,7),
  customer_lng DECIMAL(10,7),
  delivery_mode VARCHAR(10) NOT NULL DEFAULT 'delivery'
    CHECK (delivery_mode IN ('delivery', 'pickup')),
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'ready', 'delivered', 'cancelled')),
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  delivery_charge DECIMAL(10,2) NOT NULL DEFAULT 0,
  grand_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  cancelled_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_store_orders_business
  ON store_orders (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_orders_status
  ON store_orders (business_id, status);

-- Store order line items
CREATE TABLE IF NOT EXISTS store_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id UUID,
  item_name VARCHAR(255) NOT NULL,
  variant_name VARCHAR(255),
  quantity DECIMAL(10,3) NOT NULL DEFAULT 1,
  unit VARCHAR(50) NOT NULL DEFAULT 'PCS',
  unit_price DECIMAL(12,2) NOT NULL,
  tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_store_order_items_order
  ON store_order_items (order_id);

-- Reserved subdomains (checked at application level, listed here for reference)
COMMENT ON COLUMN business_settings.store_subdomain IS
  'Subdomain for the public store ({value}.khatario.com). Must be unique, lowercase, 3-63 chars.';
