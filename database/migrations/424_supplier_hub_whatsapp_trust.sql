-- 424: Supplier Hub on WhatsApp, and trust signals in the directory.
--
-- WhatsApp: hub notices (new order, proposal, bill, dispatch, connection request) are written
-- to an outbox in the same transaction as the in-app notice, then sent from the platform
-- number with the approved 'supplier_hub_update' template. A business can switch them off.
-- Trust: when a supplier lists in the directory, its GSTIN is looked up in the GST registry;
-- an Active registration earns the "GST verified" badge and gives the district filter.

CREATE TABLE IF NOT EXISTS supplier_hub_whatsapp_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  detail TEXT,
  path TEXT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'skipped')),
  skip_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hub_wa_outbox_queued ON supplier_hub_whatsapp_outbox (created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_hub_wa_outbox_recent ON supplier_hub_whatsapp_outbox (business_id, path, sent_at DESC) WHERE status = 'sent';

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS hub_whatsapp_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN businesses.hub_whatsapp_enabled IS 'Send Supplier Hub updates to the business phone on WhatsApp';

ALTER TABLE business_discovery
  ADD COLUMN IF NOT EXISTS gst_verified_gstin VARCHAR(15),
  ADD COLUMN IF NOT EXISTS gst_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gst_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS gst_legal_name TEXT,
  ADD COLUMN IF NOT EXISTS gst_district VARCHAR(120);

COMMENT ON COLUMN business_discovery.gst_verified_gstin IS 'GSTIN the registry lookup was for; the badge shows only while it matches businesses.gstin';
COMMENT ON COLUMN business_discovery.gst_status IS 'Registration status from the GST registry lookup (Active, Cancelled, ...)';
COMMENT ON COLUMN business_discovery.gst_district IS 'District of the principal place of business from the GST registry';

-- Allow the new event (same list as 353, plus supplier_hub_update).
ALTER TABLE platform_whatsapp_templates DROP CONSTRAINT IF EXISTS platform_whatsapp_templates_event_key_check;
ALTER TABLE platform_whatsapp_templates ADD CONSTRAINT platform_whatsapp_templates_event_key_check
  CHECK (
    event_key IS NULL OR event_key IN (
      'signup_otp',
      'demo_booking_otp',
      'trial_ending',
      'subscription_payment_failed',
      'subscription_ended',
      'promo',
      'funnel_reengage',
      'funnel_demo_no_trial',
      'funnel_first_invoice',
      'funnel_trial_inactive',
      'funnel_trial_feature',
      'funnel_handover',
      'supplier_hub_update'
    )
  );

-- A draft template for the platform admin to submit to Meta (Admin > WhatsApp templates).
INSERT INTO platform_whatsapp_templates (name, language, category, body_text, footer_text, example_vars, event_key, status)
SELECT 'khatario_supplier_hub_update', 'en_US', 'UTILITY',
       'Supplier Hub update: {{1}}. {{2}} See it in Khatario: {{3}} Thank you.',
       'Turn these off in Supplier directory settings',
       '["Sharma Traders ordered 4 items", "Confirm how much of each you can supply.", "https://khatario.com/supply-orders/1f2e"]'::jsonb,
       'supplier_hub_update', 'draft'
WHERE NOT EXISTS (SELECT 1 FROM platform_whatsapp_templates WHERE event_key = 'supplier_hub_update');
