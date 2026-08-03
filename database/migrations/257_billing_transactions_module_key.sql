-- Migration 257: Tag SaaS billing receipts with product module (Billing / HR / Connect)

ALTER TABLE billing_transactions
  ADD COLUMN IF NOT EXISTS module_key VARCHAR(32);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_transactions_module_key_check'
  ) THEN
    ALTER TABLE billing_transactions
      ADD CONSTRAINT billing_transactions_module_key_check
      CHECK (module_key IS NULL OR module_key IN ('billing', 'hr', 'connect', 'crm'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_billing_tx_module
  ON billing_transactions(business_id, module_key, created_at DESC);

COMMENT ON COLUMN billing_transactions.module_key IS
  'Product module this payment applies to (billing, hr, connect).';

-- Backfill from plan product_line
UPDATE billing_transactions bt
SET module_key = CASE
  WHEN sp.product_line = 'hr' THEN 'hr'
  WHEN sp.product_line = 'connect' THEN 'connect'
  ELSE 'billing'
END
FROM subscription_plans sp
WHERE bt.plan_id = sp.id
  AND bt.module_key IS NULL;
