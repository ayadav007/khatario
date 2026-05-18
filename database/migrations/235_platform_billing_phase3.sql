-- Phase 3: platform billing webhooks audit + email templates

ALTER TABLE platform_settings
    ADD COLUMN IF NOT EXISTS email_templates JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS platform_billing_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,
    idempotency_key TEXT NOT NULL,
    event_type VARCHAR(120) NOT NULL,
    business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
    billing_transaction_id UUID REFERENCES billing_transactions(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'received',
    payload JSONB DEFAULT '{}',
    processing_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT platform_billing_webhook_events_idem_unique UNIQUE (provider, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_platform_billing_webhook_created
    ON platform_billing_webhook_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_billing_webhook_business
    ON platform_billing_webhook_events(business_id) WHERE business_id IS NOT NULL;

COMMENT ON COLUMN platform_settings.email_templates IS 'Editable platform email copy keyed by template id';
COMMENT ON TABLE platform_billing_webhook_events IS 'Audit log for SaaS subscription payment webhooks (Razorpay, etc.)';
