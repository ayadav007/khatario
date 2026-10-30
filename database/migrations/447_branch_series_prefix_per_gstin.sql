-- Migration 447: own tax invoice / bill of supply prefix for every branch sharing a GSTIN
-- Rule 46(b) / 49: one consecutive series per GSTIN. Migration 319 gave a prefix only to
-- non-default branches with no invoices yet, so a branch that already had invoices kept the
-- default "INV" and could issue the same number as the head office on the same GSTIN.
-- Here every active non-default branch that shares its GSTIN with another active branch, and has
-- no prefix of its own, gets INV-<code> / BOS-<code>. Its next document starts a new series
-- (numbering continues from its own counter); earlier documents keep their numbers.
-- Safe to re-run.

WITH reg AS (
  SELECT br.id, br.name, br.branch_code, COALESCE(br.is_default, false) AS is_default,
         CASE
           WHEN NULLIF(UPPER(TRIM(br.gstin)), '') IS NOT NULL
            AND UPPER(TRIM(br.gstin)) <> COALESCE(UPPER(TRIM(b.gstin)), '')
           THEN UPPER(TRIM(br.gstin))
           ELSE ''
         END AS reg_key,
         br.business_id
    FROM branches br
    JOIN businesses b ON b.id = br.business_id
   WHERE COALESCE(br.is_active, true) = true
),
shared AS (
  SELECT r.*,
         UPPER(COALESCE(
           NULLIF(REGEXP_REPLACE(COALESCE(r.branch_code, ''), '[^A-Za-z0-9]', '', 'g'), ''),
           -- No branch code: name initials plus a slice of the id, so two "Main ..." branches differ.
           COALESCE(NULLIF(LEFT(REGEXP_REPLACE(r.name, '[^A-Za-z0-9]', '', 'g'), 3), ''), 'BR')
             || LEFT(REPLACE(r.id::text, '-', ''), 3)
         )) AS tag
    FROM reg r
   WHERE NOT r.is_default
     AND EXISTS (
       SELECT 1 FROM reg o
        WHERE o.business_id = r.business_id AND o.reg_key = r.reg_key AND o.id <> r.id
     )
),
series(document_type, head) AS (
  VALUES ('tax_invoice', 'INV'), ('bill_of_supply', 'BOS')
)
INSERT INTO branch_document_prefixes (branch_id, document_type, prefix)
SELECT s.id, se.document_type, LEFT(se.head || '-' || s.tag, 50)
  FROM shared s
 CROSS JOIN series se
 WHERE NOT EXISTS (
   SELECT 1 FROM branch_document_prefixes p
    WHERE p.branch_id = s.id
      AND (p.document_type = se.document_type OR (se.document_type = 'tax_invoice' AND p.document_type = 'regular'))
 )
ON CONFLICT (branch_id, document_type) DO NOTHING;
