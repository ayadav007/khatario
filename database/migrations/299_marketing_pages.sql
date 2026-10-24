-- Site Builder: platform-managed marketing pages (Puck documents).
-- draft_* is edited by platform admins; published_* is what visitors see.

CREATE TABLE IF NOT EXISTS marketing_pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(80) NOT NULL UNIQUE,
    draft_data JSONB,
    draft_updated_at TIMESTAMPTZ,
    draft_updated_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
    published_data JSONB,
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_page_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_slug VARCHAR(80) NOT NULL REFERENCES marketing_pages(slug) ON DELETE CASCADE,
    data JSONB NOT NULL,
    published_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_page_versions_slug_created
    ON marketing_page_versions (page_slug, created_at DESC);

INSERT INTO marketing_pages (slug) VALUES ('home') ON CONFLICT (slug) DO NOTHING;
