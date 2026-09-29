-- Reversal-based corrections (accounting audit, Phase 2)
--   * ledger_entry_reversals links every reversal line to the one original line it mirrors.
--     original_line_id is the primary key, so a line can be reversed at most once; a line that
--     is itself a reversal cannot be reversed. A voucher's current posting is its lines that are
--     neither reversed nor reversals.
--   * Existing 'Reversal:' lines (lib/ledger-reversal.ts before this migration) are linked to
--     their originals.
--   * Links are append-only; they are removed only together with their lines by a declared
--     ledger delete (migration 323) or a tenant purge.
--   * Document columns for corrections that no longer delete rows: expenses soft delete,
--     purchase cancellation, and release of advance adjustments on cancelled documents.

CREATE TABLE IF NOT EXISTS ledger_entry_reversals (
  original_line_id UUID PRIMARY KEY REFERENCES ledger_entry_lines(id),
  reversal_line_id UUID NOT NULL UNIQUE REFERENCES ledger_entry_lines(id),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  voucher_type VARCHAR(50) NOT NULL,
  voucher_id UUID NOT NULL,
  reason TEXT,
  created_by UUID,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (original_line_id <> reversal_line_id)
);

CREATE INDEX IF NOT EXISTS idx_ledger_entry_reversals_voucher
  ON ledger_entry_reversals (business_id, voucher_type, voucher_id);

CREATE OR REPLACE FUNCTION validate_ledger_entry_reversal()
RETURNS TRIGGER AS $$
DECLARE
  o ledger_entry_lines%ROWTYPE;
  r ledger_entry_lines%ROWTYPE;
BEGIN
  SELECT * INTO o FROM ledger_entry_lines WHERE id = NEW.original_line_id;
  SELECT * INTO r FROM ledger_entry_lines WHERE id = NEW.reversal_line_id;
  IF o.id IS NULL OR r.id IS NULL THEN
    RAISE EXCEPTION 'Reversal link refers to a missing ledger line' USING ERRCODE = 'P0001';
  END IF;
  IF o.business_id <> r.business_id OR o.business_id <> NEW.business_id
     OR o.voucher_type <> r.voucher_type OR o.voucher_id <> r.voucher_id
     OR o.voucher_type <> NEW.voucher_type OR o.voucher_id <> NEW.voucher_id THEN
    RAISE EXCEPTION 'A reversal line must belong to the same business and voucher as its original'
      USING ERRCODE = 'P0001';
  END IF;
  IF o.account_id <> r.account_id OR o.debit <> r.credit OR o.credit <> r.debit THEN
    RAISE EXCEPTION 'Reversal line % does not mirror original line %', r.id, o.id USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM ledger_entry_reversals WHERE reversal_line_id = NEW.original_line_id) THEN
    RAISE EXCEPTION 'Ledger line % is a reversal and cannot itself be reversed', o.id USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM ledger_entry_reversals WHERE original_line_id = NEW.reversal_line_id) THEN
    RAISE EXCEPTION 'Ledger line % is an original posting and cannot be used as a reversal', r.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_ledger_entry_reversal_trigger ON ledger_entry_reversals;
CREATE TRIGGER validate_ledger_entry_reversal_trigger
  BEFORE INSERT ON ledger_entry_reversals
  FOR EACH ROW
  EXECUTE FUNCTION validate_ledger_entry_reversal();

CREATE OR REPLACE FUNCTION protect_ledger_entry_reversal()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND ledger_delete_reason() IS NOT NULL THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ledger_entry_reversals rows are append-only'
    USING ERRCODE = 'P0001', HINT = 'LEDGER_DELETE_FORBIDDEN';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_ledger_entry_reversal_trigger ON ledger_entry_reversals;
CREATE TRIGGER protect_ledger_entry_reversal_trigger
  BEFORE UPDATE OR DELETE ON ledger_entry_reversals
  FOR EACH ROW
  EXECUTE FUNCTION protect_ledger_entry_reversal();

DROP TRIGGER IF EXISTS prevent_ledger_reversals_truncate_trigger ON ledger_entry_reversals;
CREATE TRIGGER prevent_ledger_reversals_truncate_trigger
  BEFORE TRUNCATE ON ledger_entry_reversals
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_ledger_truncate();

-- Same guard as 323, plus: an allowed delete first drops the reversal links of the line
-- (declared deletes remove whole vouchers, so both sides of a link go together).
CREATE OR REPLACE FUNCTION guard_ledger_entry_delete()
RETURNS TRIGGER AS $$
DECLARE
  v_reason TEXT := ledger_delete_reason();
  v_actor UUID := ledger_delete_actor();
  v_snapshot JSONB := to_jsonb(OLD);
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Ledger entry % (% %) cannot be deleted. Post a reversal entry instead.',
      OLD.id, OLD.voucher_type, OLD.voucher_id
      USING ERRCODE = 'P0001', HINT = 'LEDGER_DELETE_FORBIDDEN';
  END IF;

  IF v_reason = 'tenant_purge' THEN
    IF EXISTS (SELECT 1 FROM businesses WHERE id = OLD.business_id) THEN
      RAISE EXCEPTION 'tenant_purge may only delete ledger entries of a business being deleted (entry %)', OLD.id
        USING ERRCODE = 'P0001', HINT = 'LEDGER_DELETE_FORBIDDEN';
    END IF;
    DELETE FROM ledger_entry_reversals WHERE original_line_id = OLD.id OR reversal_line_id = OLD.id;
    DELETE FROM ledger_entry_history WHERE ledger_entry_line_id = OLD.id;
    RETURN OLD;
  END IF;

  IF is_period_locked(OLD.business_id, OLD.branch_id, OLD.entry_date) THEN
    RAISE EXCEPTION 'Cannot delete ledger entry in locked period. Entry date: %, Business: %, Branch: %',
      OLD.entry_date, OLD.business_id, OLD.branch_id
      USING ERRCODE = 'P0001', HINT = 'LEDGER_PERIOD_LOCKED';
  END IF;

  DELETE FROM ledger_entry_reversals WHERE original_line_id = OLD.id OR reversal_line_id = OLD.id;

  INSERT INTO ledger_entry_deletions (
    ledger_entry_line_id, business_id, branch_id, voucher_id, voucher_type, account_id,
    entry_date, debit, credit, line_snapshot, reason, deleted_by
  ) VALUES (
    OLD.id, OLD.business_id, OLD.branch_id, OLD.voucher_id, OLD.voucher_type, OLD.account_id,
    OLD.entry_date, OLD.debit, OLD.credit, v_snapshot, v_reason, v_actor
  );

  INSERT INTO ledger_entry_history (ledger_entry_line_id, action, action_by, old_value, reason)
  VALUES (OLD.id, 'deleted', v_actor, v_snapshot, v_reason);

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Backfill: pair each 'Reversal:' line with an unreversed original of the same voucher and
-- account with debit/credit swapped, in creation order.
DO $$
DECLARE
  v_rev INT;
  v_linked INT;
BEGIN
  WITH rev AS (
    SELECT l.id, l.business_id, l.voucher_type, l.voucher_id, l.account_id, l.debit, l.credit,
           row_number() OVER (PARTITION BY l.business_id, l.voucher_type, l.voucher_id, l.account_id, l.debit, l.credit
                              ORDER BY l.created_at, l.id) AS rn
      FROM ledger_entry_lines l
     WHERE l.narration LIKE 'Reversal:%'
       AND NOT EXISTS (SELECT 1 FROM ledger_entry_reversals x WHERE x.reversal_line_id = l.id)
  ),
  orig AS (
    SELECT l.id, l.business_id, l.voucher_type, l.voucher_id, l.account_id, l.debit, l.credit,
           row_number() OVER (PARTITION BY l.business_id, l.voucher_type, l.voucher_id, l.account_id, l.debit, l.credit
                              ORDER BY l.created_at, l.id) AS rn
      FROM ledger_entry_lines l
     WHERE (l.narration IS NULL OR l.narration NOT LIKE 'Reversal:%')
       AND NOT EXISTS (SELECT 1 FROM ledger_entry_reversals x WHERE x.original_line_id = l.id)
  )
  INSERT INTO ledger_entry_reversals (original_line_id, reversal_line_id, business_id, voucher_type, voucher_id, reason)
  SELECT o.id, r.id, r.business_id, r.voucher_type, r.voucher_id, 'backfill (migration 324)'
    FROM rev r
    JOIN orig o
      ON o.business_id = r.business_id AND o.voucher_type = r.voucher_type AND o.voucher_id = r.voucher_id
     AND o.account_id = r.account_id AND o.debit = r.credit AND o.credit = r.debit AND o.rn = r.rn;

  SELECT count(*) INTO v_rev FROM ledger_entry_lines WHERE narration LIKE 'Reversal:%';
  SELECT count(*) INTO v_linked
    FROM ledger_entry_lines l
   WHERE l.narration LIKE 'Reversal:%'
     AND EXISTS (SELECT 1 FROM ledger_entry_reversals x WHERE x.reversal_line_id = l.id);
  RAISE NOTICE 'ledger_entry_reversals backfill: % reversal lines, % linked, % unmatched',
    v_rev, v_linked, v_rev - v_linked;
END $$;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS delete_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_expenses_business_live ON expenses (business_id, expense_date) WHERE deleted_at IS NULL;

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS cancelled_by UUID;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE advance_adjustments ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMP;
ALTER TABLE advance_adjustments ADD COLUMN IF NOT EXISTS reversed_by UUID;
ALTER TABLE advance_adjustments ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

COMMENT ON TABLE ledger_entry_reversals IS
  'Links each reversal ledger line to the original line it mirrors; a line is reversed at most once';
