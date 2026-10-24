-- Khatario's own payment gateway for subscription and add-on billing.
-- Chosen and configured from Admin > Settings > Payments. Secrets are AES-256-GCM encrypted.
-- NULL columns fall back to the PLATFORM_* env vars.

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS platform_payment_provider TEXT,
  ADD COLUMN IF NOT EXISTS platform_razorpay_key_id TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_platform_razorpay_key_secret TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_platform_razorpay_webhook_secret TEXT,
  ADD COLUMN IF NOT EXISTS platform_easebuzz_key TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_platform_easebuzz_salt TEXT,
  ADD COLUMN IF NOT EXISTS platform_easebuzz_environment TEXT;

ALTER TABLE platform_settings DROP CONSTRAINT IF EXISTS platform_settings_payment_provider_chk;
ALTER TABLE platform_settings ADD CONSTRAINT platform_settings_payment_provider_chk
  CHECK (platform_payment_provider IS NULL OR platform_payment_provider IN ('razorpay', 'easebuzz'));

ALTER TABLE platform_settings DROP CONSTRAINT IF EXISTS platform_settings_easebuzz_env_chk;
ALTER TABLE platform_settings ADD CONSTRAINT platform_settings_easebuzz_env_chk
  CHECK (platform_easebuzz_environment IS NULL OR platform_easebuzz_environment IN ('sandbox', 'production'));

COMMENT ON COLUMN platform_settings.platform_payment_provider IS 'Gateway for Khatario subscription billing; NULL = PLATFORM_PAYMENT_PROVIDER env';
COMMENT ON COLUMN platform_settings.encrypted_platform_razorpay_key_secret IS 'AES-256-GCM Razorpay key secret for platform billing';
COMMENT ON COLUMN platform_settings.encrypted_platform_razorpay_webhook_secret IS 'AES-256-GCM Razorpay webhook secret for platform billing';
COMMENT ON COLUMN platform_settings.encrypted_platform_easebuzz_salt IS 'AES-256-GCM Easebuzz salt for platform billing';
