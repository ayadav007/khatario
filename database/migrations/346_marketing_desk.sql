-- Platform marketing desk: Khatario's own Page, Instagram, and ad account.
-- The access token is encrypted. Brief and caps are not secrets.

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS encrypted_marketing_access_token TEXT,
  ADD COLUMN IF NOT EXISTS marketing_page_id TEXT,
  ADD COLUMN IF NOT EXISTS marketing_instagram_user_id TEXT,
  ADD COLUMN IF NOT EXISTS marketing_ad_account_id TEXT,
  ADD COLUMN IF NOT EXISTS marketing_pixel_id TEXT,
  ADD COLUMN IF NOT EXISTS marketing_brief JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN platform_settings.encrypted_marketing_access_token IS 'AES-256-GCM system user token for the Khatario marketing desk';
COMMENT ON COLUMN platform_settings.marketing_brief IS 'Standing brief, landing URL, daily cap, and stop rule';

CREATE TABLE IF NOT EXISTS marketing_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caption TEXT NOT NULL,
    headline TEXT NOT NULL DEFAULT '',
    image_path TEXT NOT NULL,
    scheduled_for DATE NOT NULL,
    angle TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    fb_post_id TEXT,
    ig_media_id TEXT,
    error TEXT,
    created_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    posted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT marketing_posts_status_chk CHECK (status IN ('draft', 'approved', 'posted', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_marketing_posts_queue
    ON marketing_posts (status, scheduled_for);

CREATE TABLE IF NOT EXISTS marketing_ads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    headline TEXT NOT NULL,
    primary_text TEXT NOT NULL,
    image_path TEXT NOT NULL,
    daily_budget_paise INTEGER NOT NULL,
    targeting JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    meta_campaign_id TEXT,
    meta_adset_id TEXT,
    meta_creative_id TEXT,
    meta_ad_id TEXT,
    last_insights JSONB,
    last_error TEXT,
    created_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT marketing_ads_status_chk CHECK (
      status IN ('draft', 'paused', 'pending_review', 'active', 'rejected', 'paused_by_rule', 'failed')
    ),
    CONSTRAINT marketing_ads_budget_chk CHECK (daily_budget_paise > 0)
);

CREATE INDEX IF NOT EXISTS idx_marketing_ads_status ON marketing_ads (status);
