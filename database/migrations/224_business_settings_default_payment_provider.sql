-- Preferred PSP for hosted payment links (WhatsApp bot, etc.)
-- When NULL/empty, callers may fallback to heuristics or manual UPI method.

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS default_payment_provider VARCHAR(64);

COMMENT ON COLUMN business_settings.default_payment_provider IS
  'Preferred payment provider id for hosted payment links (e.g. razorpay, cashfree, phonepe).';

