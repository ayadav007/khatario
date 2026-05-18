-- Supplier credit limit (parity with customers; 0 = unlimited)
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(12, 2) DEFAULT 0;

COMMENT ON COLUMN suppliers.credit_limit IS 'Maximum payable credit for this supplier; 0 means unlimited';
