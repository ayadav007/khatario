-- Migration 476 follow-up: Shiprocket post-deploy sync (ruling R6).
--
-- Run once after the new code is live (`pm2 reload`), against that environment's database:
--   node scripts/run-migration.js database/scripts/476-post-deploy-shiprocket-sync.sql
-- Safe to run twice: the second run inserts and updates nothing.
-- Never against production until scripts/setup-khatario-production.sh has been run.
--
-- Why: scripts/deploy-vps.sh runs migrations before the build, so for the length of the build the old code
-- runs on the migrated database and still writes Shiprocket logins to the old business_settings columns.
-- Migration 476's copy INSERT (ON CONFLICT DO NOTHING) does not pick those writes up again.
--
-- 1. The same copy INSERT as migration 476: a business that first saved Shiprocket during the build gets its row.
-- 2. A reconcile UPDATE: a row that is still exactly the copy (never saved or changed by the new code:
--    updated_at = created_at and last_verified_at IS NULL) is refreshed from the old columns when they differ.
--    secrets_enc is built the same way as the INSERT. updated_at is left alone on purpose, so the row still
--    reads as a copy and a second run compares against the same values and changes nothing.

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

UPDATE business_integrations bi
   SET config = src.config,
       secrets_enc = src.secrets_enc,
       webhook_token_hash = src.webhook_token_hash
  FROM (
    SELECT business_id,
           jsonb_build_object('email', store_shiprocket_email) AS config,
           CASE WHEN store_shiprocket_password_enc IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('password', store_shiprocket_password_enc) END AS secrets_enc,
           store_shiprocket_webhook_token_hash AS webhook_token_hash
      FROM business_settings
  ) src
 WHERE bi.business_id = src.business_id
   AND bi.provider = 'shiprocket'
   AND bi.updated_at = bi.created_at
   AND bi.last_verified_at IS NULL
   AND (bi.config IS DISTINCT FROM src.config
        OR bi.secrets_enc IS DISTINCT FROM src.secrets_enc
        OR bi.webhook_token_hash IS DISTINCT FROM src.webhook_token_hash);
