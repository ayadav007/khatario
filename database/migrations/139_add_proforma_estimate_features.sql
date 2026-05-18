-- Migration: Add Estimates/Quotations Features to Proforma Invoices
-- This enables proforma invoices to have expiry dates and estimate status tracking
-- (draft, sent, accepted, rejected, expired, converted)

-- Add expiry_date column to invoices table (for proforma invoices)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- Add estimate_status column to invoices table (for proforma invoices)
-- This tracks the quote/estimate lifecycle: draft, sent, accepted, rejected, expired, converted
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS estimate_status VARCHAR(20) DEFAULT 'draft';

-- Add constraint to ensure estimate_status is valid
ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS valid_estimate_status;

ALTER TABLE invoices
  ADD CONSTRAINT valid_estimate_status CHECK (
    estimate_status IS NULL OR estimate_status IN (
      'draft',
      'sent',
      'accepted',
      'rejected',
      'expired',
      'converted'
    )
  );

-- Add index for faster queries on estimate_status
CREATE INDEX IF NOT EXISTS idx_invoices_estimate_status 
  ON invoices(estimate_status) 
  WHERE document_type = 'proforma_invoice';

-- Add index for expiry_date queries
CREATE INDEX IF NOT EXISTS idx_invoices_expiry_date 
  ON invoices(expiry_date) 
  WHERE document_type = 'proforma_invoice' AND expiry_date IS NOT NULL;

-- Add comments
COMMENT ON COLUMN invoices.expiry_date IS 'Expiry date for proforma invoices (estimates/quotations). Quote validity period.';
COMMENT ON COLUMN invoices.estimate_status IS 'Status for proforma invoices: draft, sent, accepted, rejected, expired, converted';
