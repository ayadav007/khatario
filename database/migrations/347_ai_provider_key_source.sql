-- The agent runs on either the shop's own provider key or Khatario's key (paid add-on).
-- Keys move to api_key_encrypted (AES-GCM, lib/secret-encryption.ts); run
-- `node scripts/encrypt-ai-provider-keys.mjs` once to encrypt existing rows. The plain
-- api_key column is kept for one release so old code paths keep working, then dropped.

ALTER TABLE ai_provider_config
  ALTER COLUMN api_key DROP NOT NULL;

ALTER TABLE ai_provider_config
  ADD COLUMN IF NOT EXISTS key_source VARCHAR(16) NOT NULL DEFAULT 'own',
  ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS api_key_last4 VARCHAR(8);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_provider_config_key_source_check'
  ) THEN
    ALTER TABLE ai_provider_config
      ADD CONSTRAINT ai_provider_config_key_source_check CHECK (key_source IN ('own', 'khatario'));
  END IF;
END $$;

UPDATE ai_provider_config
   SET api_key_last4 = RIGHT(api_key, 4)
 WHERE api_key IS NOT NULL AND api_key <> '' AND api_key_last4 IS NULL;
