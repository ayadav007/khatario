-- GST Alert Center: a dismissed compliance alert records why and when (who is dismissed_by, from 326),
-- so the Dismissed tab shows an audit trail. Resolution stays automatic (lib/gst/compliance/engine.ts).
ALTER TABLE gst_compliance_alerts ADD COLUMN IF NOT EXISTS dismissed_reason VARCHAR(300);
ALTER TABLE gst_compliance_alerts ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_gst_compliance_alerts_resolved
  ON gst_compliance_alerts (business_id, resolved_at DESC)
  WHERE resolved_at IS NOT NULL;
