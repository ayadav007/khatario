-- GST return filing lifecycle (per business / branch / calendar month YYYY-MM).
-- Audit: no deletes on gst_filings; history is append-only.

CREATE TABLE IF NOT EXISTS gst_filings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  gst_period VARCHAR(7) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'filed', 'revised')),
  filed_at TIMESTAMPTZ,
  filed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE gst_filings IS 'GST return filing state per calendar month; do not delete rows (compliance audit).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_gst_filings_business_period_null_branch
  ON gst_filings (business_id, gst_period)
  WHERE branch_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gst_filings_business_branch_period
  ON gst_filings (business_id, branch_id, gst_period)
  WHERE branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gst_filings_business_period
  ON gst_filings (business_id, gst_period);

CREATE INDEX IF NOT EXISTS idx_gst_filings_status
  ON gst_filings (business_id, status);

CREATE TABLE IF NOT EXISTS gst_filing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gst_filing_id UUID NOT NULL REFERENCES gst_filings(id) ON DELETE RESTRICT,
  action VARCHAR(32) NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_gst_filing_history_filing
  ON gst_filing_history (gst_filing_id, created_at DESC);

COMMENT ON TABLE gst_filing_history IS 'Append-only audit trail for GST filing actions.';

DROP TRIGGER IF EXISTS trg_gst_filings_updated_at ON gst_filings;
CREATE TRIGGER trg_gst_filings_updated_at
  BEFORE UPDATE ON gst_filings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
