-- Migration 449: credit and debit note numbers unique per GSTIN, not per business
-- Rule 53: each GSTIN issues its notes in its own consecutive series. debit_notes had one
-- business-wide unique number, so a second GSTIN could not start its own DN-001; credit_notes had
-- no uniqueness at all. As with invoices (migration 319), the database keeps numbers unique per
-- branch and the API checks every branch on the same GSTIN under an advisory lock.
-- Safe to re-run.

ALTER TABLE debit_notes DROP CONSTRAINT IF EXISTS unique_business_debit_note;
DROP INDEX IF EXISTS unique_business_debit_note;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_debit_notes_branch_number
    ON debit_notes (branch_id, debit_note_number);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Per-branch debit note number index not created: duplicate numbers exist within a branch';
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_notes_branch_number
    ON credit_notes (branch_id, credit_note_number);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Per-branch credit note number index not created: duplicate numbers exist within a branch';
END $$;
