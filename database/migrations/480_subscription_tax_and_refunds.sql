-- 480: refunds of Khatario's own subscription payments (SUB-06). A later task of the same plan appends the tax parts.
--
-- A refund is a billing_transactions row with type = 'refund' (already allowed by billing_transactions_type_check):
-- no new columns, so the billing archive (lib/platform-billing-archive.ts, billing_transactions_archive, migration 479)
-- copies refund rows exactly as it copies payments when a business is deleted. Nothing is lost on delete.
--   status          pending -> completed | failed
--   amount, total_amount   the refunded amount in rupees
--   payment_reference      the gateway refund id (Razorpay refund id, Easebuzz merchant_refund_id)
--   metadata.refund_of     id of the payment being refunded
--   metadata.idempotency_key (optional)   a key the caller sent; a repeat with it returns the same refund
-- The payment row records the paise refunded or being refunded in metadata.refunded_paise (written by the refund code).
--
-- This file adds only indexes. Idempotent. Never fails on existing data: when data would violate a unique rule the
-- rule is skipped with a NOTICE. Never modifies or deletes an existing payment row.

SET LOCAL lock_timeout = '5s';

-- Finding the refunds of one payment (the refund code sums them while it holds the payment row lock).
CREATE INDEX IF NOT EXISTS idx_billing_tx_refund_of
  ON billing_transactions ((metadata->>'refund_of'))
  WHERE type = 'refund';

DO $$
DECLARE
  dups integer;
BEGIN
  LOCK TABLE billing_transactions IN SHARE ROW EXCLUSIVE MODE;

  -- One gateway refund id is one refund row, so a webhook for a refund made in the gateway dashboard
  -- (or a redelivered one) can never create two rows.
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_billing_tx_refund_gateway_ref') THEN
    RAISE NOTICE '480: uq_billing_tx_refund_gateway_ref already exists';
  ELSE
    SELECT COUNT(*) INTO dups FROM (
      SELECT payment_method, payment_reference
      FROM billing_transactions
      WHERE type = 'refund' AND payment_reference IS NOT NULL AND status <> 'failed'
      GROUP BY payment_method, payment_reference
      HAVING COUNT(*) > 1
    ) d;
    IF dups > 0 THEN
      RAISE NOTICE '480: skipped uq_billing_tx_refund_gateway_ref: % duplicate refund reference(s) exist', dups;
    ELSE
      CREATE UNIQUE INDEX uq_billing_tx_refund_gateway_ref
        ON billing_transactions (payment_method, payment_reference)
        WHERE type = 'refund' AND payment_reference IS NOT NULL AND status <> 'failed';
    END IF;
  END IF;

  -- A caller-supplied idempotency key is unique per refunded payment.
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_billing_tx_refund_idempotency') THEN
    RAISE NOTICE '480: uq_billing_tx_refund_idempotency already exists';
  ELSE
    SELECT COUNT(*) INTO dups FROM (
      SELECT metadata->>'refund_of', metadata->>'idempotency_key'
      FROM billing_transactions
      WHERE type = 'refund' AND metadata->>'idempotency_key' IS NOT NULL
      GROUP BY 1, 2
      HAVING COUNT(*) > 1
    ) d;
    IF dups > 0 THEN
      RAISE NOTICE '480: skipped uq_billing_tx_refund_idempotency: % duplicate key(s) exist', dups;
    ELSE
      CREATE UNIQUE INDEX uq_billing_tx_refund_idempotency
        ON billing_transactions ((metadata->>'refund_of'), (metadata->>'idempotency_key'))
        WHERE type = 'refund' AND metadata->>'idempotency_key' IS NOT NULL;
    END IF;
  END IF;
END $$;
