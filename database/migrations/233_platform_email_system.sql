-- Platform email delivery logs and admin notification preferences

CREATE TABLE IF NOT EXISTS platform_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    notify_new_signup BOOLEAN NOT NULL DEFAULT true,
    notify_subscription_changes BOOLEAN NOT NULL DEFAULT true,
    notify_payment_failures BOOLEAN NOT NULL DEFAULT true,
    platform_notify_email TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO platform_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    template_key VARCHAR(80),
    business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'sent',
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT platform_email_logs_status_chk CHECK (status IN ('sent', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_platform_email_logs_created
    ON platform_email_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_email_logs_business
    ON platform_email_logs(business_id) WHERE business_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_email_logs_template
    ON platform_email_logs(template_key);

COMMENT ON TABLE platform_settings IS 'Singleton platform-wide settings (id = default)';
COMMENT ON TABLE platform_email_logs IS 'Audit log for platform SMTP emails to tenants and admins';
