-- Migration 468: receivable account per customer.
-- Description: A customer can be assigned a ledger account under Accounts Receivable
-- (for example Domestic Debtors or Foreign Debtors). The customer's invoices, receipts and
-- notes post to that account. NULL keeps today's behaviour: the business's receivable
-- control account (the mapped account, else code 1103).
--
-- customer_receivable_account_moves records each change of account. When the customer had a
-- balance in another receivable account, a 'receivable_transfer' voucher whose voucher_id is
-- the move's id carries that balance to the new account on transfer_date. Rows of kind
-- 'correction' carry the same kind of voucher for a document reversed after a move.
--
-- Accounts are deactivated, never deleted, in normal use; the only hard delete is a tenant
-- purge, which removes the business by cascade. SET NULL and CASCADE keep that purge independent
-- of the order in which the cascade reaches customers, moves and accounts.
--
-- No existing row is changed. Safe to run more than once.
-- Created: 2026-11-10

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS receivable_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_receivable_account
  ON customers (business_id, receivable_account_id)
  WHERE receivable_account_id IS NOT NULL;

COMMENT ON COLUMN customers.receivable_account_id IS
  'Ledger account under Accounts Receivable that this customer posts to. NULL = the receivable control account.';

CREATE TABLE IF NOT EXISTS customer_receivable_account_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  to_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  transfer_date DATE NOT NULL,
  -- Signed Dr - Cr moved into to_account_id; 0 when the customer had no balance elsewhere.
  transferred_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  -- 'move': the customer's account was changed. 'correction': a document posted before a move
  -- was reversed afterwards; its mirror lines stay on the old account (a reversal must mirror
  -- its original) and this voucher carries them to to_account_id on the same date.
  kind VARCHAR(20) NOT NULL DEFAULT 'move' CHECK (kind IN ('move', 'correction')),
  source_voucher_type VARCHAR(50),
  source_voucher_id UUID,
  created_by UUID,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_receivable_account_moves_customer
  ON customer_receivable_account_moves (business_id, customer_id, created_at DESC);
