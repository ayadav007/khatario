-- GST compliance alerts: rule-based checks (Rule 37, 30 November ITC / credit note deadline,
-- GSTR-3B due dates) raised by lib/gst/compliance. One row per business + alert_key; a row is
-- resolved when its check stops finding the problem and re-notified only when its stage changes.

CREATE TABLE IF NOT EXISTS gst_compliance_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  check_id VARCHAR(40) NOT NULL,
  alert_key VARCHAR(200) NOT NULL,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  stage VARCHAR(40) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  legal_ref VARCHAR(200) NOT NULL,
  action_url VARCHAR(300),
  action_label VARCHAR(80),
  ask_question VARCHAR(300),
  due_date DATE,
  amount NUMERIC(15, 2),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ,
  notified_stage VARCHAR(40),
  notified_at TIMESTAMPTZ,
  dismissed_stage VARCHAR(40),
  dismissed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_gst_compliance_alerts_key UNIQUE (business_id, alert_key)
);

CREATE INDEX IF NOT EXISTS idx_gst_compliance_alerts_active
  ON gst_compliance_alerts (business_id, severity)
  WHERE resolved_at IS NULL;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notification_type;
ALTER TABLE notifications ADD CONSTRAINT chk_notification_type CHECK (type IN (
    'supplier_request',
    'supplier_approved',
    'supplier_rejected',
    'supplier_access_granted',
    'low_stock_alert',
    'quantity_request',
    'quantity_response',
    'hub_connection_request',
    'hub_connection_accepted',
    'hub_connection_declined',
    'payment_reminder',
    'invoice_due',
    'invoice_nearing_due',
    'invoice_overdue',
    'invoice_viewed',
    'todo_reminder',
    'store_enquiry',
    'gst_compliance',
    'general'
)) NOT VALID;

DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE gst_compliance_alerts TO PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'khatario_user') THEN
    GRANT ALL PRIVILEGES ON TABLE gst_compliance_alerts TO khatario_user;
  END IF;
END $$;

COMMENT ON TABLE gst_compliance_alerts IS 'Rule-based GST compliance alerts per business (lib/gst/compliance)';
