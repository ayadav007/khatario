-- 419: Where each Connect lead came from.
--
-- * whatsapp_conversations.source: first touch only, set once when the chat starts —
--     ctwa_ad   Click-to-WhatsApp ad or post (Meta Cloud API referral)
--     link      a tracked wa.me link, its QR code or the website chat button
--     indiamart IndiaMART buy-lead pulled with the business's CRM key
--     lead_api  pushed to the business's inbound lead webhook (JustDial, Facebook Lead Ads via Zapier, …)
--   NULL means direct / unknown (and every chat from before this migration).
-- * whatsapp_entry_links: tracked links. The code travels in the prefilled message ("… (ref K7Q2MX)")
--   so the first message can be matched on both the Cloud API and QR-linked numbers.
-- * whatsapp_lead_sources: a business's IndiaMART key or inbound webhook token, with what to do
--   with each new lead (stage, agent, labels).
-- * whatsapp_lead_imports: one row per outside lead, so a lead is never imported twice.

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS source VARCHAR(16),
  ADD COLUMN IF NOT EXISTS source_detail JSONB,
  ADD COLUMN IF NOT EXISTS source_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_conversations_source_check') THEN
    ALTER TABLE whatsapp_conversations
      ADD CONSTRAINT whatsapp_conversations_source_check
      CHECK (source IS NULL OR source IN ('ctwa_ad', 'link', 'indiamart', 'lead_api'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS whatsapp_conversations_source_idx
  ON whatsapp_conversations (business_id, source) WHERE source IS NOT NULL;

CREATE TABLE IF NOT EXISTS whatsapp_entry_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  -- Short public code: /w/<code> and the "(ref <code>)" in the message. Unique across Khatario.
  code VARCHAR(12) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  -- The business WhatsApp number the link opens, digits with country code.
  phone VARCHAR(20) NOT NULL,
  prefill_text VARCHAR(500) NOT NULL DEFAULT '',
  stage_id UUID REFERENCES whatsapp_pipeline_stages(id) ON DELETE SET NULL,
  assign_to UUID REFERENCES users(id) ON DELETE SET NULL,
  label_ids UUID[] NOT NULL DEFAULT '{}',
  clicks INTEGER NOT NULL DEFAULT 0,
  qr_scans INTEGER NOT NULL DEFAULT 0,
  widget_clicks INTEGER NOT NULL DEFAULT 0,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS whatsapp_entry_links_business_idx
  ON whatsapp_entry_links (business_id, archived, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_lead_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('indiamart', 'webhook')),
  name VARCHAR(80) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  -- IndiaMART CRM key, encrypted with lib/secret-encryption.
  encrypted_key TEXT,
  -- Inbound webhook: SHA-256 of the URL token (the token is shown once), and its last 4 characters.
  token_hash VARCHAR(64) UNIQUE,
  token_hint VARCHAR(8),
  stage_id UUID REFERENCES whatsapp_pipeline_stages(id) ON DELETE SET NULL,
  assign_to UUID REFERENCES users(id) ON DELETE SET NULL,
  label_ids UUID[] NOT NULL DEFAULT '{}',
  -- IndiaMART: end of the last window fetched; the next pull starts here.
  synced_until TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_result JSONB,
  last_error VARCHAR(500),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS whatsapp_lead_sources_business_idx ON whatsapp_lead_sources (business_id);
-- One IndiaMART connection per business.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_lead_sources_indiamart_uniq
  ON whatsapp_lead_sources (business_id) WHERE kind = 'indiamart';

CREATE TABLE IF NOT EXISTS whatsapp_lead_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_source_id UUID NOT NULL REFERENCES whatsapp_lead_sources(id) ON DELETE CASCADE,
  external_id VARCHAR(120) NOT NULL,
  conversation_id UUID REFERENCES whatsapp_conversations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_source_id, external_id)
);
