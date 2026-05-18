-- Immutable GST filing snapshot (JSON) + revision delta for amendment audit trail.

ALTER TABLE gst_filings
  ADD COLUMN IF NOT EXISTS gst_snapshot JSONB;

ALTER TABLE gst_filings
  ADD COLUMN IF NOT EXISTS revision_delta JSONB;

COMMENT ON COLUMN gst_filings.gst_snapshot IS 'Point-in-time GSTR-3B-derived payload at last file/revise; do not mutate in application code.';
COMMENT ON COLUMN gst_filings.revision_delta IS 'Last revision: prior snapshot preserved + net payable differences (audit).';
