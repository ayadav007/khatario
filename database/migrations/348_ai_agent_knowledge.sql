-- Knowledge the shop owner adds for their AI agent: FAQs, pasted text and text extracted from
-- uploaded files (the file itself is not stored). Indexed into kb_* as tenant_faq,
-- tenant_text and tenant_file for the tenant_customer audience.

CREATE TABLE IF NOT EXISTS ai_agent_knowledge (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('faq', 'text', 'file')),
    title VARCHAR(200),
    question TEXT,
    answer TEXT,
    content TEXT,
    file_name VARCHAR(255),
    file_size INTEGER,
    status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_knowledge_business
    ON ai_agent_knowledge (business_id, kind);

ALTER TABLE kb_sources DROP CONSTRAINT IF EXISTS kb_sources_kind_check;
ALTER TABLE kb_sources
  ADD CONSTRAINT kb_sources_kind_check CHECK (kind IN (
    'markdown', 'plans', 'marketing_page', 'tenant_policy', 'tenant_catalog', 'tenant_url',
    'tenant_faq', 'tenant_text', 'tenant_file'
  ));
