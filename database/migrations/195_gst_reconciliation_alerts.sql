-- GST GSTR-1 vs GSTR-3B reconciliation alerts (auto-detected, audit history)

CREATE TABLE IF NOT EXISTS gst_reconciliation_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  gst_period TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('live_vs_live', 'filed_vs_live', 'filed_vs_filed')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  severity TEXT CHECK (severity IN ('low', 'medium', 'high')),
  summary TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gst_rec_alerts_business_period
  ON gst_reconciliation_alerts (business_id, gst_period DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gst_rec_alerts_open
  ON gst_reconciliation_alerts (business_id)
  WHERE status = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS idx_gst_rec_alerts_one_open_scope
  ON gst_reconciliation_alerts (business_id, branch_id, gst_period, mode)
  WHERE status = 'open';

COMMENT ON TABLE gst_reconciliation_alerts IS 'Derived GST reconciliation mismatch alerts; one open row per business/branch/period/mode';
