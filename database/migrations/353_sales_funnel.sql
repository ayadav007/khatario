-- WhatsApp sales funnel for Meta click-to-WhatsApp leads on Khatario's own number.
-- flow_step is where the lead is in the bot conversation; pipeline_status is the sales stage and
-- is only changed by server code (flow actions, signup, first invoice, payment), never by the AI.

ALTER TABLE assistant_leads
  ADD COLUMN IF NOT EXISTS wa_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS flow_step VARCHAR(64),
  ADD COLUMN IF NOT EXISTS flow_version INTEGER,
  ADD COLUMN IF NOT EXISTS pipeline_status VARCHAR(20) NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS pain_point VARCHAR(64),
  ADD COLUMN IF NOT EXISTS entry_key VARCHAR(64),
  ADD COLUMN IF NOT EXISTS ad_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS ad_source_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS ad_source_url TEXT,
  ADD COLUMN IF NOT EXISTS ad_headline TEXT,
  ADD COLUMN IF NOT EXISTS ctwa_clid TEXT,
  ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS campaign_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS flow_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_outbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_funnel_message_id TEXT,
  ADD COLUMN IF NOT EXISTS demo_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS demo_read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS conversion_value NUMERIC(12, 2);

ALTER TABLE assistant_leads DROP CONSTRAINT IF EXISTS assistant_leads_pipeline_status_check;
ALTER TABLE assistant_leads ADD CONSTRAINT assistant_leads_pipeline_status_check
  CHECK (pipeline_status IN ('new', 'qualified', 'demo_interested', 'trial_created', 'activated', 'converted', 'lost'));

CREATE INDEX IF NOT EXISTS idx_assistant_leads_pipeline ON assistant_leads (pipeline_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_leads_business ON assistant_leads (business_id) WHERE business_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assistant_leads_ad ON assistant_leads (ad_id) WHERE ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assistant_leads_funnel_msg ON assistant_leads (last_funnel_message_id) WHERE last_funnel_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES assistant_leads(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL,
  from_step VARCHAR(64),
  to_step VARCHAR(64),
  from_status VARCHAR(20),
  to_status VARCHAR(20),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON lead_events (lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_events_status ON lead_events (to_status, created_at) WHERE to_status IS NOT NULL;

CREATE TABLE IF NOT EXISTS lead_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES assistant_leads(id) ON DELETE CASCADE,
  kind VARCHAR(48) NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'cancelled', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_via VARCHAR(16),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_followups_pending
  ON lead_followups (lead_id, kind) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_lead_followups_due ON lead_followups (due_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS sales_flow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  definition JSONB NOT NULL,
  note TEXT,
  created_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
  published_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_flow_one_published ON sales_flow_versions ((status)) WHERE status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_flow_one_draft ON sales_flow_versions ((status)) WHERE status = 'draft';

CREATE TABLE IF NOT EXISTS sales_flow_media (
  key VARCHAR(64) PRIMARY KEY,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('image', 'video')),
  label VARCHAR(200),
  storage_path TEXT NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  meta_media_id TEXT,
  meta_uploaded_at TIMESTAMPTZ,
  header_handle TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meta_ad_mappings (
  ad_id VARCHAR(64) PRIMARY KEY,
  campaign_id VARCHAR(64),
  campaign_name VARCHAR(255),
  ad_name VARCHAR(255),
  entry_key VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE platform_whatsapp_templates
  ADD COLUMN IF NOT EXISTS header_format VARCHAR(16) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS header_media_key VARCHAR(64),
  ADD COLUMN IF NOT EXISTS header_handle TEXT;

ALTER TABLE platform_whatsapp_templates DROP CONSTRAINT IF EXISTS platform_whatsapp_templates_header_format_check;
ALTER TABLE platform_whatsapp_templates ADD CONSTRAINT platform_whatsapp_templates_header_format_check
  CHECK (header_format IN ('none', 'text', 'image', 'video'));

UPDATE platform_whatsapp_templates SET header_format = 'text'
 WHERE header_format = 'none' AND header_text IS NOT NULL AND TRIM(header_text) <> '';

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
      'funnel_handover'
    )
  );

COMMENT ON TABLE lead_events IS 'Audit log of sales funnel step and pipeline changes per assistant lead';
COMMENT ON TABLE lead_followups IS 'Scheduled WhatsApp follow-ups for funnel leads; one pending row per lead and kind';
COMMENT ON TABLE sales_flow_versions IS 'WhatsApp sales flow definitions; one draft and one published at a time';
COMMENT ON TABLE sales_flow_media IS 'Demo video and images used by the sales flow and template headers';
COMMENT ON TABLE meta_ad_mappings IS 'Meta ad id to campaign and flow entry, since click-to-WhatsApp referrals carry only the ad id';
