-- Org-level GSTR-3B cadence (defaults for due-date / late-fee hints; overridable per API call).
-- Persist compliance inputs at filing time for audit.

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS gst_filing_frequency VARCHAR(16) NOT NULL DEFAULT 'monthly'
    CHECK (gst_filing_frequency IN ('monthly', 'qrmp')),
  ADD COLUMN IF NOT EXISTS gst_qrmp_due_day SMALLINT NOT NULL DEFAULT 22
    CHECK (gst_qrmp_due_day IN (22, 24));

COMMENT ON COLUMN business_settings.gst_filing_frequency IS 'Default GSTR-3B cadence: monthly (20th) or QRMP (22nd/24th after quarter).';
COMMENT ON COLUMN business_settings.gst_qrmp_due_day IS 'When gst_filing_frequency is qrmp: statutory due day in the month after quarter-end (22 or 24).';

ALTER TABLE gst_filings
  ADD COLUMN IF NOT EXISTS charges_snapshot JSONB;

COMMENT ON COLUMN gst_filings.charges_snapshot IS 'Point-in-time inputs for interest/late fee (due date, dates used, cash base, day counts) — audit trail.';
