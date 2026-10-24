-- valid_upi_id used {2,256}; Postgres caps regex repetition at 255, so every UPI insert failed with
-- "invalid regular expression: invalid repetition count(s)". upi_id is VARCHAR(100), so 99 is the real cap.

ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS valid_upi_id;
ALTER TABLE payment_methods ADD CONSTRAINT valid_upi_id CHECK (
  method_type <> 'upi'
  OR (upi_id IS NOT NULL AND upi_id ~ '^[a-zA-Z0-9._-]{2,99}@[a-zA-Z0-9]{2,64}$')
) NOT VALID;
