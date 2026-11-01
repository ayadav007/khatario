-- Migration 456: GSTR-1 filing record per GSTIN, not per business
-- Each GSTIN files its own GSTR-1 (s.37 / s.25(2) CGST Act). gstr1_filings allowed one row per
-- business per month, so a Tamil Nadu branch reused the Karnataka filing record and marking one
-- filed locked the other's invoices. `gstin` is the registration the return is filed under
-- ('' when the business has no GSTIN). Existing rows take the GSTIN of the branch their snapshot
-- was built for, else the business GSTIN.
-- Safe to re-run.

ALTER TABLE gstr1_filings
  ADD COLUMN IF NOT EXISTS gstin VARCHAR(15) NOT NULL DEFAULT '';

UPDATE gstr1_filings f
   SET gstin = COALESCE(
         NULLIF(UPPER(TRIM(br.gstin)), ''),
         NULLIF(UPPER(TRIM(b.gstin)), ''),
         ''
       )
  FROM branches br
  JOIN businesses b ON b.id = br.business_id
 WHERE f.gstin = ''
   AND br.business_id = f.business_id
   AND br.id::text = f.gstr1_snapshot->>'branch_id';

-- Rows with no snapshot (or whose snapshot branch is gone) file under the business GSTIN.
UPDATE gstr1_filings f
   SET gstin = COALESCE(NULLIF(UPPER(TRIM(b.gstin)), ''), '')
  FROM businesses b
 WHERE b.id = f.business_id
   AND f.gstin = '';

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'gstr1_filings'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) ~* '^UNIQUE \(business_id, filing_period\)$'
  LOOP
    EXECUTE format('ALTER TABLE gstr1_filings DROP CONSTRAINT %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT i.relname AS indexname
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
     WHERE x.indrelid = 'gstr1_filings'::regclass
       AND x.indisunique
       AND NOT x.indisprimary
       AND pg_get_indexdef(x.indexrelid) ~* '\(business_id, filing_period\)$'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', r.indexname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gstr1_filings_business_gstin_period
  ON gstr1_filings (business_id, gstin, filing_period);

COMMENT ON COLUMN gstr1_filings.gstin IS 'GSTIN this GSTR-1 is filed under ('''' if the business has no GSTIN). One filing per GSTIN per period.';
