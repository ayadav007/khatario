-- Khatario AI assistant (RAG) foundation.
-- pgvector is optional: when the extension cannot be created the embedding column and
-- HNSW index are skipped and retrieval runs on full-text + trigram only. Re-running
-- this migration after installing pgvector (or `npm run kb:enable-vector`) adds them.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector not available (%). Assistant will use full-text retrieval only.', SQLERRM;
  END;
END $$;

CREATE TABLE IF NOT EXISTS kb_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kind VARCHAR(32) NOT NULL
      CHECK (kind IN ('markdown', 'plans', 'marketing_page', 'tenant_policy', 'tenant_catalog', 'tenant_url')),
    locator TEXT NOT NULL,
    audiences TEXT[] NOT NULL DEFAULT ARRAY['prospect']::TEXT[],
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    content_hash VARCHAR(64),
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'ok', 'error', 'deleted')),
    error TEXT,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    last_indexed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kb_sources_locator
    ON kb_sources (kind, locator, COALESCE(business_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS kb_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
    doc_key TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    audiences TEXT[] NOT NULL,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    locale VARCHAR(16) NOT NULL DEFAULT 'en',
    tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    required_feature VARCHAR(100),
    content_hash VARCHAR(64) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_id, doc_key)
);

CREATE TABLE IF NOT EXISTS kb_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    heading_path TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    token_estimate INTEGER NOT NULL DEFAULT 0,
    audiences TEXT[] NOT NULL,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    locale VARCHAR(16) NOT NULL DEFAULT 'en',
    embedding_model VARCHAR(100),
    tsv TSVECTOR GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce(heading_path, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(content, '')), 'B')
    ) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (document_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_tsv ON kb_chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_trgm ON kb_chunks USING GIN (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_audiences ON kb_chunks USING GIN (audiences);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_business ON kb_chunks (business_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_hash ON kb_chunks (content_hash);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'kb_chunks' AND column_name = 'embedding'
    ) THEN
      EXECUTE 'ALTER TABLE kb_chunks ADD COLUMN embedding vector(768)';
    END IF;
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding ON kb_chunks USING hnsw (embedding vector_cosine_ops)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS assistant_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200),
    phone VARCHAR(20),
    email VARCHAR(255),
    business_name VARCHAR(255),
    business_type VARCHAR(100),
    city VARCHAR(100),
    team_size VARCHAR(50),
    needs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    recommended_plan VARCHAR(100),
    source_channel VARCHAR(32) NOT NULL,
    visitor_id VARCHAR(64),
    conversation_id UUID,
    booking_id UUID REFERENCES demo_bookings(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'new'
      CHECK (status IN ('new', 'contacted', 'demo_booked', 'trial_started', 'converted', 'lost')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_leads_phone ON assistant_leads (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assistant_leads_created ON assistant_leads (created_at DESC);

CREATE TABLE IF NOT EXISTS kb_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel VARCHAR(32) NOT NULL
      CHECK (channel IN ('web', 'signup', 'trial_app', 'in_app', 'whatsapp')),
    audience VARCHAR(32) NOT NULL,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID,
    visitor_id VARCHAR(64),
    phone VARCHAR(20),
    lead_id UUID REFERENCES assistant_leads(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'handed_off', 'closed')),
    page_path TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_conversations_visitor ON kb_conversations (visitor_id);
CREATE INDEX IF NOT EXISTS idx_kb_conversations_last ON kb_conversations (last_message_at DESC);

CREATE TABLE IF NOT EXISTS kb_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES kb_conversations(id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    cited_chunk_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    retrieval JSONB,
    intent VARCHAR(32),
    action JSONB,
    model VARCHAR(100),
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    answered BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_messages_conversation ON kb_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_kb_messages_created ON kb_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_messages_unanswered ON kb_messages (created_at DESC)
    WHERE role = 'assistant' AND answered = false;

ALTER TABLE assistant_leads
    DROP CONSTRAINT IF EXISTS fk_assistant_leads_conversation;
ALTER TABLE assistant_leads
    ADD CONSTRAINT fk_assistant_leads_conversation
    FOREIGN KEY (conversation_id) REFERENCES kb_conversations(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS kb_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID NOT NULL UNIQUE REFERENCES kb_messages(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- scope = 'platform' for Khatario-wide switches, 'business:<uuid>' for tenant bots (phase 3).
CREATE TABLE IF NOT EXISTS assistant_settings (
    scope VARCHAR(80) PRIMARY KEY,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO assistant_settings (scope, settings)
VALUES ('platform', '{"channels": {"web": true, "signup": true, "trial_app": true}}'::jsonb)
ON CONFLICT (scope) DO NOTHING;
