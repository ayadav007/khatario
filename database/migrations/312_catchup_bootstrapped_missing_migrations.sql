-- Re-applies 177, 196, 197, 198, 199. On staging (and production, which clones
-- staging's schema_migrations) these were marked applied by the runner's
-- auto-bootstrap (MIGRATION_BASELINE) but never executed. Every statement is
-- idempotent so this is a no-op where the objects already exist.

-- 177_quantity_request_events
CREATE TABLE IF NOT EXISTS quantity_request_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quantity_request_id UUID NOT NULL REFERENCES quantity_requests(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(40) NOT NULL,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quantity_request_events_request
  ON quantity_request_events(quantity_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quantity_request_events_business
  ON quantity_request_events(business_id, created_at DESC);

COMMENT ON TABLE quantity_request_events IS
  'Append-only audit log: created, responded, mapping_updated, document_linked, spawn_upstream';

-- 196_gst_reconciliation_alert_history
CREATE TABLE IF NOT EXISTS gst_reconciliation_alert_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id UUID NOT NULL REFERENCES gst_reconciliation_alerts(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('opened', 'updated', 'resolved', 'severity_changed')),
  previous_severity TEXT CHECK (previous_severity IS NULL OR previous_severity IN ('low', 'medium', 'high')),
  new_severity TEXT CHECK (new_severity IS NULL OR new_severity IN ('low', 'medium', 'high')),
  previous_totals_difference NUMERIC,
  new_totals_difference NUMERIC,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gst_rec_alert_hist_alert
  ON gst_reconciliation_alert_history (alert_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gst_rec_alert_hist_business
  ON gst_reconciliation_alert_history (business_id, created_at DESC);

COMMENT ON TABLE gst_reconciliation_alert_history IS 'Append-only audit log for gst_reconciliation_alerts state transitions';

-- 197_gst_alert_notification_prefs_and_logs
CREATE TABLE IF NOT EXISTS gst_alert_notification_prefs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
  notify_on TEXT[] NOT NULL DEFAULT ARRAY['high', 'medium']::text[],
  include_low BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  cooldown_minutes INT NOT NULL DEFAULT 120 CHECK (cooldown_minutes >= 0 AND cooldown_minutes <= 10080),
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gst_alert_prefs_biz_only
  ON gst_alert_notification_prefs (business_id)
  WHERE branch_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gst_alert_prefs_biz_branch
  ON gst_alert_notification_prefs (business_id, branch_id)
  WHERE branch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gst_alert_notification_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id UUID REFERENCES gst_reconciliation_alerts(id) ON DELETE SET NULL,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  gst_period TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('live_vs_live', 'filed_vs_live', 'filed_vs_filed')),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  recipient TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error TEXT,
  trigger_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gst_alert_notif_log_cooldown
  ON gst_alert_notification_logs (business_id, gst_period, mode, branch_id, created_at DESC);

COMMENT ON TABLE gst_alert_notification_prefs IS 'Per-business (optional per-branch) channels for GST reconciliation alerts';
COMMENT ON TABLE gst_alert_notification_logs IS 'GST alert notification attempts for cooldown and audit';

-- 198_bank_statement_imports_enhanced
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bank_accounts_branch_id ON bank_accounts(branch_id);

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

-- 199_bank_statement_reconciliation_status
ALTER TABLE bank_statements
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT;

UPDATE bank_statements
SET reconciliation_status = CASE
  WHEN is_reconciled = true THEN 'completed'
  ELSE 'in_progress'
END
WHERE reconciliation_status IS NULL;

ALTER TABLE bank_statements
  ALTER COLUMN reconciliation_status SET DEFAULT 'in_progress';

ALTER TABLE bank_statements
  ALTER COLUMN reconciliation_status SET NOT NULL;

ALTER TABLE bank_statements
  DROP CONSTRAINT IF EXISTS bank_statements_reconciliation_status_check;

ALTER TABLE bank_statements
  ADD CONSTRAINT bank_statements_reconciliation_status_check
  CHECK (reconciliation_status IN ('in_progress', 'completed'));

COMMENT ON COLUMN bank_statements.reconciliation_status IS 'in_progress until user completes; completed locks workflow';
