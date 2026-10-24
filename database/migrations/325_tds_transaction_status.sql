-- TDS transaction lifecycle (accounting audit, Phase 2.6)
--   * A TDS row is no longer deleted when its purchase is cancelled or its draft is deleted.
--     The row is marked cancelled and its voucher is reversed; the row and both postings remain.
--   * Registers, summaries, certificates, threshold aggregates and deposit selection read only
--     active rows.
--   * TDS that has been deposited to the government cannot be cancelled.
--   * Idempotent: safe to run more than once.

ALTER TABLE tds_transactions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE tds_transactions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE tds_transactions ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tds_transactions ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'tds_transactions'::regclass AND conname = 'tds_transactions_status_check'
  ) THEN
    ALTER TABLE tds_transactions
      ADD CONSTRAINT tds_transactions_status_check CHECK (status IN ('active', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'tds_transactions'::regclass AND conname = 'tds_transactions_cancelled_not_deposited'
  ) THEN
    ALTER TABLE tds_transactions
      ADD CONSTRAINT tds_transactions_cancelled_not_deposited
      CHECK (NOT (status = 'cancelled' AND COALESCE(is_deposited, false)));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tds_transactions_active_period
  ON tds_transactions (business_id, financial_year, quarter)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_tds_transactions_purchase
  ON tds_transactions (purchase_id)
  WHERE purchase_id IS NOT NULL;
