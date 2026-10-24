-- Migration 335: Payment reversal lifecycle (Phase 4.4)
--   * A posted payment is corrected by reversal, never by edit or delete. The payment row and
--     its voucher stay; the reversal posts mirror lines linked in ledger_entry_reversals (324),
--     dated in the open period.
--   * payments.status is 'active' for every existing row (column default) or 'reversed'.
--     A reversed payment keeps who/when/why and a reference to its payment_reversals row, and
--     can never return to active.
--   * payment_reversals: one immutable row per reversed payment (UNIQUE payment_id).
--   * Permission module payment_reversals: its Create flag is the payments:reverse permission.
--     No role is granted it here; the primary admin is always allowed.
--   * Idempotent: safe to run more than once. No existing row is modified.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMP;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reversal_reason TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reversal_id UUID;

CREATE TABLE IF NOT EXISTS payment_reversals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
  reversal_date DATE NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  amount DECIMAL(12,2) NOT NULL,
  tds_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  reversed_line_count INTEGER NOT NULL CHECK (reversed_line_count > 0),
  document_effect VARCHAR(30) NOT NULL
    CHECK (document_effect IN ('document_reopened', 'cancelled_invoice_credit', 'on_account')),
  cancelled_tds_transaction_ids UUID[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_reversals_business_date
  ON payment_reversals (business_id, reversal_date);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'payments'::regclass AND conname = 'payments_status_check'
  ) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('active', 'reversed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'payments'::regclass AND conname = 'payments_reversal_fields_check'
  ) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_reversal_fields_check CHECK (
      (status = 'active' AND reversed_at IS NULL AND reversal_id IS NULL AND reversal_reason IS NULL AND reversed_by IS NULL)
      OR (status = 'reversed' AND reversed_at IS NOT NULL AND reversal_id IS NOT NULL AND reversal_reason IS NOT NULL)
    );
  END IF;
END $$;

-- A payment becomes reversed only together with its payment_reversals row, and a reversed
-- payment's reversal and amounts never change afterwards (reversed_by may still be nulled when
-- the user is deleted).
CREATE OR REPLACE FUNCTION guard_payment_reversal_state()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'reversed' AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.reversal_id IS DISTINCT FROM OLD.reversal_id
    OR NEW.reversed_at IS DISTINCT FROM OLD.reversed_at
    OR NEW.reversal_reason IS DISTINCT FROM OLD.reversal_reason
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.tds_amount IS DISTINCT FROM OLD.tds_amount
    OR NEW.business_id IS DISTINCT FROM OLD.business_id
  ) THEN
    RAISE EXCEPTION 'Payment % is reversed; its reversal cannot be changed', OLD.id
      USING ERRCODE = 'P0001', HINT = 'PAYMENT_REVERSED_IMMUTABLE';
  END IF;
  IF OLD.status = 'active' AND NEW.status = 'reversed' AND NOT EXISTS (
    SELECT 1 FROM payment_reversals r
     WHERE r.id = NEW.reversal_id AND r.payment_id = NEW.id AND r.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'Payment % cannot be marked reversed without its reversal record', NEW.id
      USING ERRCODE = 'P0001', HINT = 'PAYMENT_REVERSAL_RECORD_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_payment_reversal_state_trigger ON payments;
CREATE TRIGGER guard_payment_reversal_state_trigger
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION guard_payment_reversal_state();

-- Rows are immutable; the only allowed change is created_by becoming NULL when its user is
-- deleted (ON DELETE SET NULL).
CREATE OR REPLACE FUNCTION protect_payment_reversal()
RETURNS TRIGGER AS $$
BEGIN
  IF (to_jsonb(NEW) - 'created_by') IS DISTINCT FROM (to_jsonb(OLD) - 'created_by')
     OR (NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    RAISE EXCEPTION 'payment_reversals rows cannot be changed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_payment_reversal_trigger ON payment_reversals;
CREATE TRIGGER protect_payment_reversal_trigger
  BEFORE UPDATE ON payment_reversals
  FOR EACH ROW
  EXECUTE FUNCTION protect_payment_reversal();

INSERT INTO permission_modules (module_key, module_name, description)
VALUES ('payment_reversals', 'Payment Reversals', 'Reverse posted payments (Create = payments:reverse)')
ON CONFLICT (module_key) DO NOTHING;
