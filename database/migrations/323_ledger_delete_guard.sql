-- Ledger delete guard (accounting audit, Phase 1)
--   Migration 123 made ledger_entry_lines immutable to UPDATE but DELETE stayed open, and
--   ledger_entry_history (126) cascaded on delete, so a removed posting left no trace.
--   * BEFORE DELETE trigger: a delete must be declared by the transaction with
--       SELECT set_config('khatario.ledger_delete_reason', '<reason>', true)
--     (lib/accounting/ledger-delete-guard.ts). Undeclared deletes and deletes of lines in a
--     locked period are refused. Every allowed delete is archived in ledger_entry_deletions
--     and logged in ledger_entry_history.
--   * Reason 'tenant_purge' is accepted only while the owning business row is being deleted;
--     it skips the archive so a purged tenant leaves no financial data behind.
--   * ledger_entry_history no longer cascades; history and the archive are append-only.
--   * TRUNCATE of ledger_entry_lines is refused.

CREATE TABLE IF NOT EXISTS ledger_entry_deletions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ledger_entry_line_id UUID NOT NULL,
  business_id UUID,
  branch_id UUID,
  voucher_id UUID,
  voucher_type VARCHAR(50),
  account_id UUID,
  entry_date DATE,
  debit NUMERIC(15,2),
  credit NUMERIC(15,2),
  line_snapshot JSONB NOT NULL,
  reason TEXT NOT NULL,
  deleted_by UUID,
  txid BIGINT NOT NULL DEFAULT txid_current(),
  deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ledger_entry_deletions_voucher
  ON ledger_entry_deletions (business_id, voucher_type, voucher_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_deletions_deleted_at
  ON ledger_entry_deletions (business_id, deleted_at DESC);

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'ledger_entry_history'::regclass
       AND con.confrelid = 'ledger_entry_lines'::regclass
       AND con.contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE ledger_entry_history DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION ledger_delete_reason()
RETURNS TEXT AS $$
  SELECT NULLIF(btrim(COALESCE(current_setting('khatario.ledger_delete_reason', true), '')), '');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION ledger_delete_actor()
RETURNS UUID AS $$
DECLARE
  v TEXT := NULLIF(btrim(COALESCE(current_setting('khatario.actor_id', true), '')), '');
BEGIN
  IF v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v::uuid;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

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
    DELETE FROM ledger_entry_history WHERE ledger_entry_line_id = OLD.id;
    RETURN OLD;
  END IF;

  IF is_period_locked(OLD.business_id, OLD.branch_id, OLD.entry_date) THEN
    RAISE EXCEPTION 'Cannot delete ledger entry in locked period. Entry date: %, Business: %, Branch: %',
      OLD.entry_date, OLD.business_id, OLD.branch_id
      USING ERRCODE = 'P0001', HINT = 'LEDGER_PERIOD_LOCKED';
  END IF;

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

DROP TRIGGER IF EXISTS guard_ledger_entry_delete_trigger ON ledger_entry_lines;
CREATE TRIGGER guard_ledger_entry_delete_trigger
  BEFORE DELETE ON ledger_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION guard_ledger_entry_delete();

CREATE OR REPLACE FUNCTION prevent_ledger_truncate()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% cannot be truncated', TG_TABLE_NAME
    USING ERRCODE = 'P0001', HINT = 'LEDGER_DELETE_FORBIDDEN';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_ledger_truncate_trigger ON ledger_entry_lines;
CREATE TRIGGER prevent_ledger_truncate_trigger
  BEFORE TRUNCATE ON ledger_entry_lines
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_ledger_truncate();

-- Audit tables: rows are deleted only by a tenant purge, and the only update allowed is
-- ledger_entry_history.action_by -> NULL (its users FK is ON DELETE SET NULL).
CREATE OR REPLACE FUNCTION protect_ledger_audit_row()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND ledger_delete_reason() = 'tenant_purge' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'ledger_entry_history' THEN
    IF (to_jsonb(NEW) ->> 'action_by') IS NULL
       AND (to_jsonb(NEW) - 'action_by') = (to_jsonb(OLD) - 'action_by') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME
    USING ERRCODE = 'P0001', HINT = 'LEDGER_DELETE_FORBIDDEN';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_ledger_entry_deletions_trigger ON ledger_entry_deletions;
CREATE TRIGGER protect_ledger_entry_deletions_trigger
  BEFORE UPDATE OR DELETE ON ledger_entry_deletions
  FOR EACH ROW
  EXECUTE FUNCTION protect_ledger_audit_row();

DROP TRIGGER IF EXISTS protect_ledger_entry_history_trigger ON ledger_entry_history;
CREATE TRIGGER protect_ledger_entry_history_trigger
  BEFORE UPDATE OR DELETE ON ledger_entry_history
  FOR EACH ROW
  EXECUTE FUNCTION protect_ledger_audit_row();

DROP TRIGGER IF EXISTS prevent_ledger_deletions_truncate_trigger ON ledger_entry_deletions;
CREATE TRIGGER prevent_ledger_deletions_truncate_trigger
  BEFORE TRUNCATE ON ledger_entry_deletions
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_ledger_truncate();

DROP TRIGGER IF EXISTS prevent_ledger_history_truncate_trigger ON ledger_entry_history;
CREATE TRIGGER prevent_ledger_history_truncate_trigger
  BEFORE TRUNCATE ON ledger_entry_history
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_ledger_truncate();

COMMENT ON TABLE ledger_entry_deletions IS
  'Full snapshot of every deleted ledger_entry_lines row, with the declared reason and actor';
COMMENT ON FUNCTION guard_ledger_entry_delete IS
  'Refuses ledger deletes without khatario.ledger_delete_reason or in a locked period; archives allowed deletes';
