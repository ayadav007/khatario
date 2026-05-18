-- Lifecycle / audit trail for GST reconciliation alerts (CA trend & "when did it start?")

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
