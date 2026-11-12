-- Migration 476: courier plugins, Phase 1. One row per business and provider while the plugin is connected.
-- config holds non-secret fields, secrets_enc holds one ciphertext per secret field (encryptPaymentSecret),
-- webhook_token_hash is the SHA-256 hash of the token the courier sends back.
-- The three old store_shiprocket_* columns are not dropped; the INSERT below copies them once and is safe to run again.

CREATE TABLE IF NOT EXISTS business_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,       -- non-secret fields, e.g. {"email": "..."}
  secrets_enc JSONB NOT NULL DEFAULT '{}'::jsonb,  -- field -> ciphertext, e.g. {"password": "<base64>"}
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,     -- plugin options (empty in Phase 1)
  webhook_token_hash VARCHAR(64),
  last_verified_at TIMESTAMPTZ,
  connected_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_integrations_webhook_token
  ON business_integrations (provider, webhook_token_hash)
  WHERE webhook_token_hash IS NOT NULL;

INSERT INTO business_integrations (business_id, provider, config, secrets_enc, webhook_token_hash)
SELECT business_id,
       'shiprocket',
       jsonb_build_object('email', store_shiprocket_email),
       CASE WHEN store_shiprocket_password_enc IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('password', store_shiprocket_password_enc) END,
       store_shiprocket_webhook_token_hash
FROM business_settings
WHERE store_shiprocket_password_enc IS NOT NULL
   OR store_shiprocket_webhook_token_hash IS NOT NULL
ON CONFLICT (business_id, provider) DO NOTHING;
