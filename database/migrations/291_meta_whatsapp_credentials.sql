-- Platform and tenant Meta Cloud API credentials (encrypted tokens; not env-only)

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS meta_wa_waba_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_wa_phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_meta_wa_access_token TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_meta_wa_app_secret TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_meta_wa_verify_token TEXT;

COMMENT ON COLUMN platform_settings.encrypted_meta_wa_access_token IS 'AES-256-GCM system user token for Khatario WABA';
COMMENT ON COLUMN platform_settings.encrypted_meta_wa_app_secret IS 'AES-256-GCM Meta app secret for webhook HMAC';
COMMENT ON COLUMN platform_settings.encrypted_meta_wa_verify_token IS 'AES-256-GCM webhook handshake token';

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS meta_waba_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS encrypted_meta_access_token TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_meta_app_secret TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_meta_verify_token TEXT;

COMMENT ON COLUMN whatsapp_config.meta_waba_id IS 'Tenant WhatsApp Business Account ID for Cloud API';
COMMENT ON COLUMN whatsapp_config.encrypted_meta_access_token IS 'AES-256-GCM tenant Cloud API access token';
COMMENT ON COLUMN whatsapp_config.phone_number_id IS 'Cloud API phone number ID (platform or tenant)';
