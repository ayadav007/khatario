-- Admin business operations: suspend tenant, impersonation tokens

ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS platform_suspended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS platform_suspend_reason TEXT;

CREATE TABLE IF NOT EXISTS admin_impersonation_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT NOT NULL UNIQUE,
    admin_id UUID NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_impersonation_expires
    ON admin_impersonation_tokens(expires_at) WHERE used_at IS NULL;

COMMENT ON COLUMN businesses.platform_suspended_at IS 'When set, tenant users cannot log in until cleared by platform admin';
COMMENT ON TABLE admin_impersonation_tokens IS 'One-time tokens for platform admin support login into a tenant account';
