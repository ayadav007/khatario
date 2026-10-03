-- Per-business Meta Cloud API message templates and the event -> template choice

CREATE TABLE IF NOT EXISTS business_whatsapp_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(512) NOT NULL,
  language VARCHAR(16) NOT NULL DEFAULT 'en_US',
  category VARCHAR(32) NOT NULL CHECK (category IN ('AUTHENTICATION', 'UTILITY', 'MARKETING')),
  header_format VARCHAR(16) NOT NULL DEFAULT 'none'
    CHECK (header_format IN ('none', 'text', 'document', 'image', 'video')),
  header_text TEXT,
  body_text TEXT NOT NULL DEFAULT '',
  footer_text TEXT,
  example_vars JSONB NOT NULL DEFAULT '[]'::jsonb,
  buttons JSONB NOT NULL DEFAULT '[]'::jsonb,
  placeholder_count INTEGER NOT NULL DEFAULT 0,
  meta_template_id TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'paused', 'disabled')),
  rejected_reason TEXT,
  source VARCHAR(16) NOT NULL DEFAULT 'khatario' CHECK (source IN ('khatario', 'meta')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, name, language)
);

CREATE INDEX IF NOT EXISTS idx_business_wa_templates_business
  ON business_whatsapp_templates (business_id, status);

CREATE TABLE IF NOT EXISTS business_whatsapp_event_templates (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  event_key VARCHAR(64) NOT NULL,
  template_id UUID NOT NULL REFERENCES business_whatsapp_templates(id) ON DELETE CASCADE,
  variable_map JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, event_key)
);

COMMENT ON TABLE business_whatsapp_templates IS 'Message templates on a business''s own WhatsApp Business Account';
COMMENT ON TABLE business_whatsapp_event_templates IS 'Which approved template a business uses for each Khatario message event; variable_map lists field keys for {{1}}..{{n}}';
