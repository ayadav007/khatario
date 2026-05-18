-- GSTR-1 immutable filing snapshot + document linkage (invoices + CDN)
-- Optional line CESS for GSTR-1 / reconciliation (defaults 0 until populated by product)

ALTER TABLE gstr1_filings
  ADD COLUMN IF NOT EXISTS gstr1_snapshot JSONB;

COMMENT ON COLUMN gstr1_filings.gstr1_snapshot IS 'Immutable JSON snapshot at GSTR-1 file time (audit). Do not mutate after status=filed.';

CREATE TABLE IF NOT EXISTS gstr1_filing_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gstr1_filing_id UUID NOT NULL REFERENCES gstr1_filings(id) ON DELETE CASCADE,
  document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('invoice', 'credit_note', 'debit_note')),
  document_id UUID NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_gstr1_filing_document UNIQUE (gstr1_filing_id, document_type, document_id)
);

CREATE INDEX IF NOT EXISTS idx_gstr1_filing_documents_filing ON gstr1_filing_documents(gstr1_filing_id);
CREATE INDEX IF NOT EXISTS idx_gstr1_filing_documents_doc ON gstr1_filing_documents(document_type, document_id);

COMMENT ON TABLE gstr1_filing_documents IS 'All outward documents included in a GSTR-1 filing (invoices + credit/debit notes) for audit and future filed-basis reconciliation.';

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS cess_amount DECIMAL(12, 2) DEFAULT 0;

COMMENT ON COLUMN invoice_items.cess_amount IS 'CESS amount for this line (optional; used in GSTR-1 / ledger 2153 reconciliation when > 0).';
