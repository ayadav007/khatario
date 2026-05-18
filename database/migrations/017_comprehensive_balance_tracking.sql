-- Migration 017: Comprehensive Balance Tracking
-- Adds proper balance tracking to purchases, customers, and suppliers

-- 1. Add payment_status and balance_amount to purchases table
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS balance_amount DECIMAL(12,2) DEFAULT 0;

-- Add constraint for payment_status
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_payment_status_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_payment_status_check 
  CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid'));

-- Backfill balance_amount for existing purchases
UPDATE purchases
SET balance_amount = grand_total - COALESCE(paid_amount, 0)
WHERE balance_amount = 0 OR balance_amount IS NULL;

-- Backfill payment_status for existing purchases
UPDATE purchases
SET payment_status = CASE
  WHEN COALESCE(paid_amount, 0) <= 0 THEN 'unpaid'
  WHEN (grand_total - COALESCE(paid_amount, 0)) <= 0 THEN 'paid'
  ELSE 'partially_paid'
END
WHERE payment_status = 'unpaid' OR payment_status IS NULL;

-- 2. Add current_balance to customers table
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS current_balance DECIMAL(12,2) DEFAULT 0;

-- Backfill customer current_balance: opening_balance + invoice balances
UPDATE customers c
SET current_balance = (
  CASE WHEN c.opening_balance_type = 'debit' THEN COALESCE(c.opening_balance, 0) ELSE -COALESCE(c.opening_balance, 0) END
) + COALESCE(
  (SELECT SUM(balance_amount) FROM invoices WHERE customer_id = c.id AND status NOT IN ('cancelled', 'draft')),
  0
);

-- 3. Add current_balance to suppliers table
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS current_balance DECIMAL(12,2) DEFAULT 0;

-- Backfill supplier current_balance: opening_balance + purchase balances
UPDATE suppliers s
SET current_balance = (
  CASE WHEN s.opening_balance_type = 'credit' THEN COALESCE(s.opening_balance, 0) ELSE -COALESCE(s.opening_balance, 0) END
) + COALESCE(
  (SELECT SUM(grand_total - COALESCE(paid_amount, 0)) FROM purchases WHERE supplier_id = s.id AND status NOT IN ('cancelled', 'draft')),
  0
);

-- 4. Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_purchases_payment_status ON purchases(payment_status);
CREATE INDEX IF NOT EXISTS idx_purchases_balance_amount ON purchases(balance_amount);
CREATE INDEX IF NOT EXISTS idx_customers_current_balance ON customers(current_balance);
CREATE INDEX IF NOT EXISTS idx_suppliers_current_balance ON suppliers(current_balance);

-- 5. Add comments
COMMENT ON COLUMN purchases.payment_status IS 'Payment status: unpaid, partially_paid, paid';
COMMENT ON COLUMN purchases.balance_amount IS 'Outstanding balance amount (grand_total - paid_amount)';
COMMENT ON COLUMN customers.current_balance IS 'Current outstanding balance including opening balance';
COMMENT ON COLUMN suppliers.current_balance IS 'Current outstanding balance including opening balance';

