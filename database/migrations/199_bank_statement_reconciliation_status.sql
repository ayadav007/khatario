-- Reconciliation workflow status on imported statements

ALTER TABLE bank_statements
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT;

UPDATE bank_statements
SET reconciliation_status = CASE
  WHEN is_reconciled = true THEN 'completed'
  ELSE 'in_progress'
END
WHERE reconciliation_status IS NULL;

ALTER TABLE bank_statements
  ALTER COLUMN reconciliation_status SET DEFAULT 'in_progress';

UPDATE bank_statements
SET reconciliation_status = 'in_progress'
WHERE reconciliation_status IS NULL;

ALTER TABLE bank_statements
  ALTER COLUMN reconciliation_status SET NOT NULL;

ALTER TABLE bank_statements
  DROP CONSTRAINT IF EXISTS bank_statements_reconciliation_status_check;

ALTER TABLE bank_statements
  ADD CONSTRAINT bank_statements_reconciliation_status_check
  CHECK (reconciliation_status IN ('in_progress', 'completed'));

COMMENT ON COLUMN bank_statements.reconciliation_status IS 'in_progress until user completes; completed locks workflow';
