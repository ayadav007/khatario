-- Migration 469: invoice revision history (edit log).
-- Description: Every committed change to an invoice, its lines (invoice_items) or its charges
-- (invoice_charges) leaves one row in invoice_revisions holding a full snapshot of the invoice
-- after that change. The History tab compares each snapshot with the one before it.
--
-- Why triggers: about 26 code paths write invoices. Capturing in the database means a path that
-- forgets still gets recorded. The triggers are constraint triggers, DEFERRABLE INITIALLY
-- DEFERRED, so they run at COMMIT, after every statement of the save: one save makes one
-- revision, and a rolled-back save makes none.
--
-- Context: the application may set three transaction-local settings before writing:
--   khatario.invoice_actor_id  user id of who made the change
--   khatario.invoice_action    what happened (created, amended, cancelled, ...)
--   khatario.invoice_reason    the reason the user typed, if any
-- Without them the revision is recorded as 'updated' (or 'created') by no one ("System").
-- These keys are separate from khatario.actor_id, which withLedgerDelete clears.
--
-- Snapshots leave out bookkeeping that is not a change to the bill: updated_at, the customer
-- link token and the view counters (view_count, last_viewed_at, first_viewed_at). A write that
-- changes only those makes no revision. Columns added to invoices or invoice_items after an
-- invoice's last revision, and NULL values, are ignored when deciding whether anything changed;
-- the stored snapshot still has every column.
--
-- Do not run SET CONSTRAINTS ALL IMMEDIATE in a transaction that writes invoices: the first
-- statement would record a half-finished invoice and later statements of that transaction none.
--
-- History cannot be edited. It outlives the invoice row: when an invoice is hard-deleted (admin
-- purge, backup restore) its revisions stay, and when backup restore inserts the invoice again
-- under the same id, history continues with a 'restored' revision. Revisions are deleted only
-- with their business (foreign key cascade, tenant purge) or while a purge reason is set via
-- withLedgerDelete.
--
-- Every invoice that exists when this runs gets a 'baseline' revision.
-- No existing row is changed. Safe to run more than once.
-- Created: 2026-11-10

CREATE TABLE IF NOT EXISTS invoice_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  -- No foreign key: history outlives the invoice row (hard delete, backup restore).
  invoice_id UUID NOT NULL,
  revision_no INT NOT NULL,
  -- txid_current() of the saving transaction; 0 for baseline rows.
  tx_id BIGINT NOT NULL,
  action VARCHAR(40) NOT NULL,
  reason TEXT,
  -- No foreign key: removing a user must never touch history. actor_name is copied at capture.
  actor_user_id UUID,
  actor_name TEXT,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoice_revisions_invoice_revision_key UNIQUE (invoice_id, revision_no),
  CONSTRAINT invoice_revisions_invoice_tx_key UNIQUE (invoice_id, tx_id)
);

-- Earlier drafts of this migration had a cascading foreign key; drop it where it exists.
ALTER TABLE invoice_revisions DROP CONSTRAINT IF EXISTS invoice_revisions_invoice_id_fkey;

CREATE INDEX IF NOT EXISTS idx_invoice_revisions_business_invoice
  ON invoice_revisions (business_id, invoice_id, revision_no DESC);

COMMENT ON TABLE invoice_revisions IS
  'Append-only edit log: one full snapshot of an invoice per committed change (migration 469).';

-- Every snapshot loads an invoice's lines; without this index each one scans invoice_items.
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items (invoice_id);

-- Snapshot of one invoice: header, lines and charges. NULL when the invoice row does not exist.
CREATE OR REPLACE FUNCTION invoice_snapshot(p_invoice_id UUID) RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'header',
      to_jsonb(i) - ARRAY['updated_at', 'view_count', 'last_viewed_at', 'first_viewed_at', 'public_token'],
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(ii) - ARRAY['id', 'invoice_id'] ORDER BY ii.sort_order, ii.id)
        FROM invoice_items ii WHERE ii.invoice_id = i.id
    ), '[]'::jsonb),
    'charges', COALESCE((
      SELECT jsonb_agg(to_jsonb(ic) - ARRAY['id', 'invoice_id', 'business_id'] ORDER BY ic.sort_order, ic.id)
        FROM invoice_charges ic WHERE ic.invoice_id = i.id
    ), '[]'::jsonb)
  )
  FROM invoices i
  WHERE i.id = p_invoice_id
$$;

-- Baseline for invoices that existed before history started.
INSERT INTO invoice_revisions (business_id, invoice_id, revision_no, tx_id, action, snapshot)
SELECT i.business_id, i.id, 1, 0, 'baseline', invoice_snapshot(i.id)
  FROM invoices i
 WHERE i.business_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoice_revisions r WHERE r.invoice_id = i.id);

-- p_new trimmed to the keys p_old had: header keys, and line/charge keys of p_old's first row.
-- Lets a column added after the last revision (with a default or NULL) count as no change.
CREATE OR REPLACE FUNCTION invoice_snapshot_like(p_new JSONB, p_old JSONB) RETURNS JSONB
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'header', COALESCE((
      SELECT jsonb_object_agg(e.key, e.value)
        FROM jsonb_each(p_new->'header') e
       WHERE (p_old->'header') ? e.key
    ), '{}'::jsonb),
    'lines', CASE
      WHEN jsonb_array_length(COALESCE(p_old->'lines', '[]'::jsonb)) = 0 THEN COALESCE(p_new->'lines', '[]'::jsonb)
      ELSE COALESCE((
        SELECT jsonb_agg((
          SELECT COALESCE(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
            FROM jsonb_each(l.value) f
           WHERE (p_old->'lines'->0) ? f.key
        ) ORDER BY l.ordinality)
          FROM jsonb_array_elements(p_new->'lines') WITH ORDINALITY l
      ), '[]'::jsonb)
    END,
    'charges', CASE
      WHEN jsonb_array_length(COALESCE(p_old->'charges', '[]'::jsonb)) = 0 THEN COALESCE(p_new->'charges', '[]'::jsonb)
      ELSE COALESCE((
        SELECT jsonb_agg((
          SELECT COALESCE(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
            FROM jsonb_each(c.value) f
           WHERE (p_old->'charges'->0) ? f.key
        ) ORDER BY c.ordinality)
          FROM jsonb_array_elements(p_new->'charges') WITH ORDINALITY c
      ), '[]'::jsonb)
    END
  )
$$;

CREATE OR REPLACE FUNCTION capture_invoice_revision(p_invoice_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_tx BIGINT := txid_current();
  v_snapshot JSONB;
  v_business UUID;
  v_last_no INT;
  v_last_snapshot JSONB;
  v_action TEXT;
  v_reason TEXT;
  v_actor_raw TEXT;
  v_actor UUID;
  v_actor_name TEXT;
BEGIN
  IF p_invoice_id IS NULL THEN
    RETURN;
  END IF;
  -- Several row events of one transaction all land here at COMMIT; the first one records.
  IF EXISTS (SELECT 1 FROM invoice_revisions WHERE invoice_id = p_invoice_id AND tx_id = v_tx) THEN
    RETURN;
  END IF;

  SELECT business_id INTO v_business FROM invoices WHERE id = p_invoice_id;
  IF v_business IS NULL THEN
    RETURN; -- invoice removed in this transaction, or not tied to a business
  END IF;
  v_snapshot := invoice_snapshot(p_invoice_id);

  SELECT revision_no, snapshot INTO v_last_no, v_last_snapshot
    FROM invoice_revisions
   WHERE invoice_id = p_invoice_id
   ORDER BY revision_no DESC
   LIMIT 1;
  IF v_last_snapshot IS NOT NULL
     AND jsonb_strip_nulls(invoice_snapshot_like(v_snapshot, v_last_snapshot))
       = jsonb_strip_nulls(invoice_snapshot_like(v_last_snapshot, v_last_snapshot)) THEN
    RETURN; -- only excluded bookkeeping changed, or only columns added since the last revision
  END IF;

  v_action := NULLIF(btrim(COALESCE(current_setting('khatario.invoice_action', true), '')), '');
  IF v_action IS NULL THEN
    v_action := CASE WHEN v_last_no IS NULL THEN 'created' ELSE 'updated' END;
  END IF;
  v_reason := NULLIF(btrim(COALESCE(current_setting('khatario.invoice_reason', true), '')), '');
  v_actor_raw := btrim(COALESCE(current_setting('khatario.invoice_actor_id', true), ''));
  IF v_actor_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_actor := v_actor_raw::uuid;
    SELECT name INTO v_actor_name FROM users WHERE id = v_actor;
  END IF;

  INSERT INTO invoice_revisions (
    business_id, invoice_id, revision_no, tx_id, action, reason, actor_user_id, actor_name, snapshot
  ) VALUES (
    v_business, p_invoice_id, COALESCE(v_last_no, 0) + 1, v_tx, left(v_action, 40), left(v_reason, 500),
    v_actor, v_actor_name, v_snapshot
  );
END;
$$;

CREATE OR REPLACE FUNCTION trg_capture_invoice_revision() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    PERFORM capture_invoice_revision(NEW.id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM capture_invoice_revision(OLD.invoice_id);
  ELSE
    PERFORM capture_invoice_revision(NEW.invoice_id);
    IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
      PERFORM capture_invoice_revision(OLD.invoice_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION guard_invoice_revisions() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (
       pg_trigger_depth() > 1 -- removed by the foreign key cascade from its business
       OR COALESCE(current_setting('khatario.ledger_delete_reason', true), '')
          IN ('tenant_purge', 'admin:purge_invoices')
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'invoice history cannot be changed' USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_revisions_guard ON invoice_revisions;
CREATE TRIGGER trg_invoice_revisions_guard
  BEFORE UPDATE OR DELETE ON invoice_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_invoice_revisions();

DROP TRIGGER IF EXISTS trg_invoice_revisions_no_truncate ON invoice_revisions;
CREATE TRIGGER trg_invoice_revisions_no_truncate
  BEFORE TRUNCATE ON invoice_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION guard_invoice_revisions();

DROP TRIGGER IF EXISTS trg_invoice_revision_header ON invoices;
CREATE CONSTRAINT TRIGGER trg_invoice_revision_header
  AFTER INSERT OR UPDATE ON invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_capture_invoice_revision();

DROP TRIGGER IF EXISTS trg_invoice_revision_items ON invoice_items;
CREATE CONSTRAINT TRIGGER trg_invoice_revision_items
  AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_capture_invoice_revision();

DROP TRIGGER IF EXISTS trg_invoice_revision_charges ON invoice_charges;
CREATE CONSTRAINT TRIGGER trg_invoice_revision_charges
  AFTER INSERT OR UPDATE OR DELETE ON invoice_charges
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_capture_invoice_revision();
