-- Link bill-scan jobs to purchases; distinguish AI extracted vs purchase finalized.

ALTER TABLE invoice_extraction_jobs
  ADD COLUMN IF NOT EXISTS purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_extraction_jobs_purchase
  ON invoice_extraction_jobs(purchase_id)
  WHERE purchase_id IS NOT NULL;

ALTER TABLE invoice_extraction_jobs DROP CONSTRAINT IF EXISTS invoice_extraction_jobs_status_check;
ALTER TABLE invoice_extraction_jobs ADD CONSTRAINT invoice_extraction_jobs_status_check
  CHECK (status IN ('processing', 'extracted', 'completed', 'failed', 'partial'));

-- Historical: AI-success jobs were marked completed before purchase-finalize workflow existed.
UPDATE invoice_extraction_jobs
   SET status = 'extracted'
 WHERE status = 'completed'
   AND purchase_id IS NULL;

COMMENT ON COLUMN invoice_extraction_jobs.purchase_id IS
  'Purchase saved from this scan (linked on draft save; status completed when purchase is final)';
COMMENT ON COLUMN invoice_extraction_jobs.status IS
  'processing | extracted (AI done) | completed (purchase final) | failed | partial';
