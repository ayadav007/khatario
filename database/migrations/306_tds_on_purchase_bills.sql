-- TDS deducted on a supplier bill settles part of the payable without being cash paid.
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS tds_deducted DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE tds_transactions
  ADD COLUMN IF NOT EXISTS purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tds_transactions_payee_fy
  ON tds_transactions (business_id, supplier_id, section_code, financial_year);
