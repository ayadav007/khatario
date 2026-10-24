-- "I have filed this return on the GST portal" marks. Lighter than gst_filings (which needs set-off
-- and payment in the ledger, snapshots the return and locks the period): most businesses file through
-- a CA, so this is how they tell Khatario a return is done. Used by GST compliance alerts.
-- GSTR-1 already has its own mark-filed flow (gstr1_filings), so only GSTR-3B is allowed for now.

CREATE TABLE IF NOT EXISTS gst_return_marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  return_type VARCHAR(10) NOT NULL CHECK (return_type IN ('GSTR3B')),
  -- YYYY-MM; for quarterly (QRMP) returns, the quarter's last month.
  period VARCHAR(7) NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  filed_on DATE NOT NULL,
  arn VARCHAR(20),
  marked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_gst_return_marks UNIQUE (business_id, return_type, period)
);

DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE gst_return_marks TO PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'khatario_user') THEN
    GRANT ALL PRIVILEGES ON TABLE gst_return_marks TO khatario_user;
  END IF;
END $$;

COMMENT ON TABLE gst_return_marks IS 'User-confirmed GST portal filings (no period lock); see lib/gst/compliance/return-marks.ts';
