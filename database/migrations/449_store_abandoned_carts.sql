-- Migration 449: Abandoned cart recovery for the online store
-- Description: Phase 4 keeps a server-side copy of each logged-in shopper's cart (one row per shopper per
--   store) so a reminder can be sent when it is left behind. store_carts.status is open, recovered (an
--   order was placed) or cleared (shopper emptied it). reminded_at / reminder_via record the one reminder
--   sent. The merchant switch and delay live next to the other store settings on business_settings.
--   Spec: docs/superpowers/specs/2026-10-29-store-shopping-features-design.md (section 7.2)
-- Created: 2026-10-30

CREATE TABLE IF NOT EXISTS store_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  items JSONB NOT NULL DEFAULT '[]',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'recovered', 'cleared')),
  reminded_at TIMESTAMPTZ,
  reminder_via VARCHAR(10),
  recovered_order_id UUID REFERENCES store_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, customer_id)
);

COMMENT ON COLUMN store_carts.items IS
  'Array of {item_id, variant_id, quantity, price, name, image_url}';
COMMENT ON COLUMN store_carts.reminder_via IS 'push | whatsapp | manual';

CREATE INDEX IF NOT EXISTS idx_store_carts_open
  ON store_carts (business_id, status, updated_at) WHERE status = 'open';

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS store_cart_reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS store_cart_reminder_hours SMALLINT NOT NULL DEFAULT 3
    CHECK (store_cart_reminder_hours BETWEEN 1 AND 72);
