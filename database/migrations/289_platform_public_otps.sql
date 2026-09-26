CREATE TABLE IF NOT EXISTS platform_public_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose VARCHAR(32) NOT NULL CHECK (purpose IN ('signup', 'demo_booking')),
  phone VARCHAR(20) NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_platform_public_otps_lookup
  ON platform_public_otps (purpose, phone, created_at DESC);

COMMENT ON TABLE platform_public_otps IS 'WhatsApp OTP for public signup and demo booking';
