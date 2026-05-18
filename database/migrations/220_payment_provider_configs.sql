-- Per-tenant PSP credentials (values stored encrypted at rest; decrypt only server-side with PAYMENT_ENCRYPTION_KEY)

CREATE TABLE IF NOT EXISTS payment_provider_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL,
    encrypted_client_id TEXT NOT NULL,
    encrypted_client_secret TEXT NOT NULL,
    environment VARCHAR(20) NOT NULL DEFAULT 'sandbox',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_payment_provider_configs_business_provider UNIQUE (business_id, provider),
    CONSTRAINT chk_payment_provider_configs_env CHECK (environment IN ('sandbox', 'production'))
);

CREATE INDEX IF NOT EXISTS idx_payment_provider_configs_business ON payment_provider_configs(business_id);

CREATE TRIGGER update_payment_provider_configs_updated_at
    BEFORE UPDATE ON payment_provider_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE payment_provider_configs IS 'PSP credentials per business; encrypted_client_* are AES-GCM ciphertext (see lib/payments/secret-encryption.ts)';
COMMENT ON COLUMN payment_provider_configs.encrypted_client_id IS 'Encrypted app/client id (never return to clients)';
COMMENT ON COLUMN payment_provider_configs.encrypted_client_secret IS 'Encrypted secret (never return to clients)';
