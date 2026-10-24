-- A mobile number identifies a person inside one business.
-- The same number may be an employee at one business and the owner of another.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_business_phone
  ON users (business_id, phone);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_business_email
  ON users (business_id, lower(email))
  WHERE email IS NOT NULL AND btrim(email) <> '';
