-- Post-filing compliance: interest (delayed payment) and late fee (delayed filing), stored separately from tax.

ALTER TABLE gst_filings
  ADD COLUMN IF NOT EXISTS interest_amount DECIMAL(15, 2),
  ADD COLUMN IF NOT EXISTS late_fee DECIMAL(15, 2);

COMMENT ON COLUMN gst_filings.interest_amount IS 'Estimated interest on delayed GST payment (18% p.a.); not part of output tax.';
COMMENT ON COLUMN gst_filings.late_fee IS 'Estimated late fee for delayed filing; not part of output tax.';
