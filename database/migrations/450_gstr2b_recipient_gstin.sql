-- Migration 450: GSTR-2B imports carry the GSTIN they were issued to
-- Each GSTIN has its own GSTR-2B and its own ITC (s.16, s.25(4)). Imports accepted any GSTIN of
-- the business but did not record which one, so one branch's 2B could match another GSTIN's
-- purchases and open its ITC gate. `recipient_gstin` is the GSTIN on the 2B; reconciliation only
-- matches a 2B row to a purchase booked under the same registration.
-- Existing imports are attributed to the business GSTIN (the only one the old importer checked
-- first); re-import a branch's 2B if it was uploaded before this migration.
-- Safe to re-run.

ALTER TABLE gstr2b_imports ADD COLUMN IF NOT EXISTS recipient_gstin VARCHAR(15);
ALTER TABLE gstr2b_invoices ADD COLUMN IF NOT EXISTS recipient_gstin VARCHAR(15);

UPDATE gstr2b_imports gi
   SET recipient_gstin = UPPER(TRIM(b.gstin))
  FROM businesses b
 WHERE b.id = gi.business_id
   AND gi.recipient_gstin IS NULL
   AND NULLIF(TRIM(b.gstin), '') IS NOT NULL;

UPDATE gstr2b_invoices inv
   SET recipient_gstin = gi.recipient_gstin
  FROM gstr2b_imports gi
 WHERE gi.id = inv.import_id
   AND inv.recipient_gstin IS NULL
   AND gi.recipient_gstin IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gstr2b_imports_recipient
  ON gstr2b_imports (business_id, recipient_gstin, filing_period);

COMMENT ON COLUMN gstr2b_imports.recipient_gstin IS 'GSTIN this GSTR-2B belongs to (one of the business or branch registrations).';
