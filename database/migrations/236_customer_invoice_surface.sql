-- Customer-facing invoice surface: public bill links, portal, view tracking.

-- Per-invoice public access token (unguessable link: /i/{public_token})
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS public_token VARCHAR(64),
  ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_public_token
  ON invoices (public_token)
  WHERE public_token IS NOT NULL;

-- Zoho-style customer portal enablement per party
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portal_invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_last_login_at TIMESTAMPTZ;

-- Business portal URL slug + promo / ad settings for public pages
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS portal_slug VARCHAR(64),
  ADD COLUMN IF NOT EXISTS customer_surface_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_settings_portal_slug
  ON business_settings (portal_slug)
  WHERE portal_slug IS NOT NULL AND portal_slug <> '';

COMMENT ON COLUMN business_settings.portal_slug IS 'Public customer portal path segment: /portal/{portal_slug}';
COMMENT ON COLUMN business_settings.customer_surface_settings IS 'Promo banner, CTAs, and surface toggles for public bill + portal pages';

-- OTP + session for customer portal (separate from staff JWT)
CREATE TABLE IF NOT EXISTS customer_portal_otps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  otp_code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_portal_otps_lookup
  ON customer_portal_otps (business_id, lower(trim(email)), created_at DESC);

CREATE TABLE IF NOT EXISTS customer_portal_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  session_token VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_portal_sessions_token
  ON customer_portal_sessions (session_token);

-- Audit trail for views (public link vs portal)
CREATE TABLE IF NOT EXISTS invoice_view_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source VARCHAR(32) NOT NULL DEFAULT 'public_link',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_invoice_view_source CHECK (source IN ('public_link', 'portal', 'email'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_view_events_invoice
  ON invoice_view_events (invoice_id, created_at DESC);

-- In-app notification when customer views a bill
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
    'invoice_viewed',
    'todo_reminder',
    'general'
));
