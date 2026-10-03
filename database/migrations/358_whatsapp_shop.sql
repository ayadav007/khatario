-- Migration 358: WhatsApp shop.
-- Cloud API numbers show the business's Meta catalog natively (View catalog, cart, Send cart);
-- QR numbers get a short-lived link to a Khatario cart page. Both end in a draft sales order and
-- a payment link from the business's own gateway; the existing paid-order flow invoices it.

CREATE TABLE IF NOT EXISTS whatsapp_shop_settings (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  meta_catalog_id VARCHAR(100),
  item_scope VARCHAR(10) NOT NULL DEFAULT 'all',
  hide_out_of_stock BOOLEAN NOT NULL DEFAULT false,
  welcome_text TEXT,
  last_synced_at TIMESTAMPTZ,
  last_sync_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN whatsapp_shop_settings.item_scope IS
  'all = every active item with a selling price; store = only items marked Show in online store';
COMMENT ON COLUMN whatsapp_shop_settings.meta_catalog_id IS
  'Meta Commerce Manager catalog connected to the business''s WhatsApp Business Account (Cloud API only)';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_shop_settings_scope_check') THEN
    ALTER TABLE whatsapp_shop_settings
      ADD CONSTRAINT whatsapp_shop_settings_scope_check CHECK (item_scope IN ('all', 'store'));
  END IF;
END $$;

-- What was last pushed to the Meta catalog, per item. item_id has no foreign key on purpose:
-- a row must outlive its item so the next sync can delete the product from Meta.
CREATE TABLE IF NOT EXISTS whatsapp_catalog_items (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  item_id UUID NOT NULL,
  catalog_id VARCHAR(100) NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, item_id)
);

-- Cart page links sent to customers on QR numbers. Only the SHA-256 of the token is stored.
CREATE TABLE IF NOT EXISTS whatsapp_shop_links (
  token_hash VARCHAR(64) PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_phone VARCHAR(20) NOT NULL,
  whatsapp_conversation_id UUID REFERENCES whatsapp_conversations(id) ON DELETE SET NULL,
  last_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_shop_links_business
  ON whatsapp_shop_links (business_id, created_at DESC);
