-- Production safety: requires_review on transactions, order payment_reference, wider webhook idempotency keys.

-- Allow manual review state when webhook amount/currency does not match order
ALTER TABLE payment_transactions DROP CONSTRAINT IF EXISTS chk_payment_transactions_status;
ALTER TABLE payment_transactions ADD CONSTRAINT chk_payment_transactions_status CHECK (
    status IN ('pending', 'success', 'failed', 'requires_review')
);

COMMENT ON COLUMN payment_transactions.status IS 'pending | success | failed | requires_review (amount/PSP data mismatch — ops review)';

-- Persist PSP reference / UTR on the sales order after verified success (webhook path)
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(255);
COMMENT ON COLUMN sales_orders.payment_reference IS 'UTR or provider payment id from last verified successful collection';

-- Composite idempotency keys can exceed 128 chars when using hashed composites
ALTER TABLE payment_webhook_events ALTER COLUMN idempotency_key TYPE VARCHAR(256);

COMMENT ON TABLE payment_webhook_events IS 'Dedup: raw-body hash and/or provider_payment_id+status composite (see lib/services/payment-webhook.ts)';
