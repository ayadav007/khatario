-- Exact webhook body replay deduplication (SHA-256 key computed server-side)

CREATE TABLE IF NOT EXISTS payment_webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_payment_webhook_events_dedup UNIQUE (business_id, provider, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_business ON payment_webhook_events(business_id);

COMMENT ON TABLE payment_webhook_events IS 'Prevents duplicate processing of identical PSP webhook payloads (hash of raw body)';
