-- Merchant password reset: WhatsApp + email OTPs (both required)

ALTER TABLE platform_public_otps DROP CONSTRAINT IF EXISTS platform_public_otps_purpose_check;
ALTER TABLE platform_public_otps
  ADD CONSTRAINT platform_public_otps_purpose_check
  CHECK (purpose IN ('signup', 'demo_booking', 'password_reset_wa', 'password_reset_email'));

COMMENT ON TABLE platform_public_otps IS 'Public OTPs: signup, demo booking, merchant password reset (WhatsApp + email)';
