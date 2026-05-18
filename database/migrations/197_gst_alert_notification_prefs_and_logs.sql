-- GST reconciliation alert notification preferences + delivery logs (cooldown / audit)

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
