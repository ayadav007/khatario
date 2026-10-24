-- Platform Meta Cloud API message templates (Khatario WABA)

CREATE TABLE IF NOT EXISTS platform_whatsapp_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(512) NOT NULL,
  language VARCHAR(16) NOT NULL DEFAULT 'en_US',
  category VARCHAR(32) NOT NULL CHECK (category IN ('AUTHENTICATION', 'UTILITY', 'MARKETING')),
  body_text TEXT NOT NULL DEFAULT '',
  header_text TEXT,
  footer_text TEXT,
  example_vars JSONB NOT NULL DEFAULT '[]'::jsonb,
  buttons JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta_template_id TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'paused', 'disabled')),
  rejected_reason TEXT,
  event_key VARCHAR(64)
    CHECK (
      event_key IS NULL OR event_key IN (
        'signup_otp',
        'demo_booking_otp',
        'trial_ending',
        'subscription_payment_failed',
        'subscription_ended',
        'promo'
      )
    ),
  created_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (name, language)
);

CREATE INDEX IF NOT EXISTS idx_platform_wa_templates_status
  ON platform_whatsapp_templates (status);
CREATE INDEX IF NOT EXISTS idx_platform_wa_templates_event
  ON platform_whatsapp_templates (event_key)
  WHERE event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform_whatsapp_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES platform_whatsapp_templates(id) ON DELETE SET NULL,
  to_phone VARCHAR(20) NOT NULL,
  event_key VARCHAR(64),
  graph_message_id TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_platform_wa_sends_created
  ON platform_whatsapp_sends (created_at DESC);

COMMENT ON TABLE platform_whatsapp_templates IS 'Khatario WABA templates submitted to Meta for review';
COMMENT ON TABLE platform_whatsapp_sends IS 'Audit log of Graph template sends (phone + status only)';
