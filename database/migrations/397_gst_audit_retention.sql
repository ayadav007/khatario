-- Audit rows must survive deletion of the purchase they describe.
-- Reconciliation history keeps the invoice identity that the decision was about.

ALTER TABLE purchase_duplicate_overrides
  ADD COLUMN IF NOT EXISTS purchase_bill_number TEXT,
  ADD COLUMN IF NOT EXISTS purchase_bill_date DATE,
  ADD COLUMN IF NOT EXISTS existing_bill_number TEXT,
  ADD COLUMN IF NOT EXISTS existing_bill_date DATE,
  ADD COLUMN IF NOT EXISTS supplier_name TEXT;

ALTER TABLE purchase_duplicate_overrides ALTER COLUMN purchase_id DROP NOT NULL;
ALTER TABLE purchase_duplicate_overrides ALTER COLUMN existing_purchase_id DROP NOT NULL;

ALTER TABLE purchase_duplicate_overrides DROP CONSTRAINT IF EXISTS purchase_duplicate_overrides_purchase_id_fkey;
ALTER TABLE purchase_duplicate_overrides
  ADD CONSTRAINT purchase_duplicate_overrides_purchase_id_fkey
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL;

ALTER TABLE purchase_duplicate_overrides DROP CONSTRAINT IF EXISTS purchase_duplicate_overrides_existing_purchase_id_fkey;
ALTER TABLE purchase_duplicate_overrides
  ADD CONSTRAINT purchase_duplicate_overrides_existing_purchase_id_fkey
  FOREIGN KEY (existing_purchase_id) REFERENCES purchases(id) ON DELETE SET NULL;

ALTER TABLE reconciliation_decision_history
  ADD COLUMN IF NOT EXISTS supplier_gstin VARCHAR(15),
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS invoice_date DATE,
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS filing_period VARCHAR(7),
  ADD COLUMN IF NOT EXISTS books_igst DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS books_cgst DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS books_sgst DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS books_cess DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS match_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS retention_reason VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_recon_decision_history_reconciliation
  ON reconciliation_decision_history (reconciliation_id);
