-- Suppliers Hub: opt-in directory, connection requests, curated published listings

-- ============================================
-- 1. Business discovery / directory profile
-- ============================================

CREATE TABLE IF NOT EXISTS business_discovery (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  visibility VARCHAR(20) NOT NULL DEFAULT 'hidden'
    CHECK (visibility IN ('hidden', 'directory', 'link_only')),
  profile_summary TEXT,
  featured_categories TEXT[] NOT NULL DEFAULT '{}',
  public_slug VARCHAR(80) UNIQUE,
  directory_approved BOOLEAN NOT NULL DEFAULT true,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_business_discovery_directory
  ON business_discovery (visibility)
  WHERE visibility = 'directory' AND directory_approved = true;

COMMENT ON TABLE business_discovery IS
  'Opt-in visibility for Suppliers Hub: hidden, directory (searchable), or link_only (not listed but profile URL works for logged-in users)';

-- ============================================
-- 2. Connection requests (buyer <-> supplier business)
-- ============================================

CREATE TABLE IF NOT EXISTS supplier_connection_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buyer_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'blocked')),
  message TEXT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ,
  CONSTRAINT supplier_connection_buyer_ne_supplier CHECK (buyer_business_id <> supplier_business_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_supplier_connection_pending
  ON supplier_connection_requests (buyer_business_id, supplier_business_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_supplier_connection_buyer
  ON supplier_connection_requests (buyer_business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_connection_supplier
  ON supplier_connection_requests (supplier_business_id, status, created_at DESC);

COMMENT ON TABLE supplier_connection_requests IS
  'Buyer requests to connect with a supplier business; accept creates/updates suppliers row with linked_business_id';

-- ============================================
-- 3. Published listings (curated subset of items)
-- ============================================

CREATE TABLE IF NOT EXISTS supplier_published_listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  audience VARCHAR(20) NOT NULL DEFAULT 'public_preview'
    CHECK (audience IN ('public_preview', 'linked_only')),
  display_name VARCHAR(255),
  moq NUMERIC(14,2),
  lead_time_text VARCHAR(120),
  price_display VARCHAR(20) NOT NULL DEFAULT 'on_request'
    CHECK (price_display IN ('hidden', 'from_amount', 'on_request')),
  from_amount NUMERIC(14,2),
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uniq_supplier_published_item UNIQUE (supplier_business_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_published_supplier
  ON supplier_published_listings (supplier_business_id, is_active, audience);

COMMENT ON TABLE supplier_published_listings IS
  'Supplier-published catalog lines for hub: public_preview (directory) vs linked_only (after active link)';

-- ============================================
-- 4. Notification types for hub
-- ============================================

-- Must include every type allowed by migration 130 (and prior) plus hub types,
-- or existing rows will violate the CHECK (23514).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notification_type;
ALTER TABLE notifications ADD CONSTRAINT chk_notification_type CHECK (type IN (
    'supplier_request',
    'supplier_approved',
    'supplier_rejected',
    'supplier_access_granted',
    'low_stock_alert',
    'quantity_request',
    'quantity_response',
    'hub_connection_request',
    'hub_connection_accepted',
    'hub_connection_declined',
    'payment_reminder',
    'invoice_due',
    'invoice_nearing_due',
    'invoice_overdue',
    'todo_reminder',
    'general'
));
