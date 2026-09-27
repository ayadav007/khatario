-- Separate number series per document type per branch.
-- Previously tax invoices, estimates (proforma) and bills of supply all advanced
-- branches.next_invoice_number, so saving an estimate left a gap in the GST invoice series.
-- Seeds each series from the highest number already used in it; the tax invoice series
-- also never goes below the old shared counter, so no previously issued number is reused.

CREATE TABLE IF NOT EXISTS branch_document_counters (
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  document_type VARCHAR(50) NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (branch_id, document_type)
);

INSERT INTO branch_document_counters (branch_id, document_type, next_number)
SELECT b.id,
       s.document_type,
       GREATEST(
         CASE WHEN s.document_type = 'tax_invoice' THEN COALESCE(b.next_invoice_number, 1) ELSE 1 END,
         COALESCE((
           SELECT MAX(SUBSTRING(i.invoice_number FROM '(\d+)$')::bigint)
           FROM invoices i
           WHERE i.branch_id = b.id
             AND i.invoice_number ~ '\d+$'
             AND (
               (s.document_type = 'tax_invoice' AND COALESCE(i.document_type, 'tax_invoice') IN ('tax_invoice', 'regular'))
               OR i.document_type = s.document_type
             )
         ), 0) + 1
       )::integer
FROM branches b
CROSS JOIN (VALUES ('tax_invoice'), ('proforma_invoice'), ('bill_of_supply')) AS s(document_type)
ON CONFLICT (branch_id, document_type) DO NOTHING;
