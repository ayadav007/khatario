-- repair: QA Run 8 (two branches, two warehouses)
--   MB2  Invoice numbers are unique per branch, not per business. Migration 125 dropped the
--        business-wide index but it was never applied on bootstrapped databases, so a second
--        branch could not issue INV-001. Drop it (index or constraint form) and ensure the
--        per-branch unique index exists.
--   MB2  Non-default branches with no invoices yet get their own tax-invoice prefix
--        (INV-<branch code>) so two branches on one GSTIN never share a series (Rule 46(b)).
-- Safe to re-run: every step checks current state first.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'invoices'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) ~* '\(business_id, invoice_number\)'
  LOOP
    EXECUTE format('ALTER TABLE invoices DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Dropped business-wide invoice number constraint %', r.conname;
  END LOOP;

  FOR r IN
    SELECT i.relname AS indexname
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
     WHERE x.indrelid = 'invoices'::regclass
       AND x.indisunique
       AND pg_get_indexdef(x.indexrelid) ~* '\(business_id, invoice_number\)'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', r.indexname);
    RAISE NOTICE 'Dropped business-wide invoice number index %', r.indexname;
  END LOOP;
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_branch_invoice_number
    ON invoices(branch_id, invoice_number);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Per-branch invoice number index not created: duplicate numbers exist within a branch';
END $$;

INSERT INTO branch_document_prefixes (branch_id, document_type, prefix)
SELECT br.id, 'tax_invoice',
       LEFT('INV-' || UPPER(COALESCE(
         NULLIF(REGEXP_REPLACE(COALESCE(br.branch_code, ''), '[^A-Za-z0-9]', '', 'g'), ''),
         NULLIF(LEFT(REGEXP_REPLACE(br.name, '[^A-Za-z0-9]', '', 'g'), 3), ''),
         'BR'
       )), 50)
  FROM branches br
 WHERE COALESCE(br.is_default, false) = false
   AND COALESCE(br.is_active, true) = true
   AND NOT EXISTS (
     SELECT 1 FROM branch_document_prefixes p
      WHERE p.branch_id = br.id AND p.document_type = 'tax_invoice'
   )
   AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.branch_id = br.id)
ON CONFLICT (branch_id, document_type) DO NOTHING;
