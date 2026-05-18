-- Structured payment terms: default credit period per customer for invoice due date hints.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_days INTEGER NULL
    CHECK (credit_days IS NULL OR credit_days >= 0);

COMMENT ON COLUMN customers.credit_days IS
  'Net days after invoice_date for suggested due_date when creating invoices; NULL = no automatic default';
