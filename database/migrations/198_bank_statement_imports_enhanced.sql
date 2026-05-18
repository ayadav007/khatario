-- Bank statement import staging + reconciliation fields (extends 066)

-- Optional branch on bank account (per-business bank can be branch-specific)
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bank_accounts_branch_id ON bank_accounts(branch_id);

-- Import batch metadata (file classification before/after confirm)
CREATE TABLE IF NOT EXISTS bank_statement_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  bank_statement_id UUID REFERENCES bank_statements(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('csv', 'pdf')),
  source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'pdf_digital', 'pdf_scanned')),
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_stmt_imports_business ON bank_statement_imports(business_id);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_imports_account ON bank_statement_imports(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_imports_statement ON bank_statement_imports(bank_statement_id);

ALTER TABLE bank_statements
  ADD COLUMN IF NOT EXISTS statement_import_id UUID REFERENCES bank_statement_imports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bank_statements_import ON bank_statements(statement_import_id);

-- Line-level reconciliation (extends 066 bank_statement_lines)
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS import_id UUID REFERENCES bank_statement_imports(id) ON DELETE SET NULL;

ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS match_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched', 'matched', 'ignored', 'partial'));

ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS matched_ledger_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_import ON bank_statement_lines(import_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_match_status ON bank_statement_lines(match_status);

COMMENT ON TABLE bank_statement_imports IS 'Uploaded bank statement file metadata (CSV/PDF classification)';
COMMENT ON COLUMN bank_statement_lines.match_status IS 'Reconciliation state vs ledger';
COMMENT ON COLUMN bank_statement_lines.matched_ledger_ids IS 'ledger_entry_lines.id values (JSON array)';
