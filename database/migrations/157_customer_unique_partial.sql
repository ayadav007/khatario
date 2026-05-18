-- Migration 157: Prevent duplicate active customers per business (normalized phone / email).
-- NULL and blank phones/emails are excluded so multiple "no contact" rows remain allowed.
-- API still returns existing row on create (see customers POST); this enforces at DB layer.

-- Phone: trim for comparison; unique among active rows with non-empty phone
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_business_phone_active
  ON customers (business_id, (trim(phone)))
  WHERE is_active = true
    AND phone IS NOT NULL
    AND trim(phone) <> '';

-- Email: case-insensitive uniqueness among active rows with non-empty email
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_business_email_active
  ON customers (business_id, (lower(trim(email))))
  WHERE is_active = true
    AND email IS NOT NULL
    AND trim(email) <> '';

COMMENT ON INDEX uq_customers_business_phone_active IS
  'One active customer per business per trimmed phone; dedupe API should run before insert.';
COMMENT ON INDEX uq_customers_business_email_active IS
  'One active customer per business per normalized email; dedupe API should run before insert.';
