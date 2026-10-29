-- Store theme engine: named themes per business (one live, others draft) and published version history.
CREATE TABLE IF NOT EXISTS store_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(60) NOT NULL,
  role VARCHAR(8) NOT NULL DEFAULT 'draft' CHECK (role IN ('live','draft')),
  preset VARCHAR(16) NOT NULL DEFAULT 'studio',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS store_themes_one_live ON store_themes (business_id) WHERE role = 'live';
CREATE INDEX IF NOT EXISTS store_themes_business ON store_themes (business_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS store_theme_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id UUID NOT NULL REFERENCES store_themes(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by UUID NULL
);
CREATE INDEX IF NOT EXISTS store_theme_versions_business ON store_theme_versions (business_id, published_at DESC);

ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS store_engine BOOLEAN NOT NULL DEFAULT false;
