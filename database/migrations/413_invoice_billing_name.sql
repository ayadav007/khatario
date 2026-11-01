-- Printed customer name for one invoice. Empty means the customer master name is used.
-- Does not rename the customer.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS billing_name VARCHAR(255);

COMMENT ON COLUMN invoices.billing_name IS
  'Name printed on this invoice only. NULL uses customers.name.';
