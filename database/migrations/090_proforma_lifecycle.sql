-- Migration: Proforma Invoice Lifecycle Management
-- This enables tracking the complete lifecycle of proforma invoices from creation to conversion/cancellation

-- Add lifecycle status column to invoices table (for proforma invoices)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS proforma_lifecycle_status VARCHAR(50) DEFAULT 'created';

-- Add lifecycle notes/description field
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS proforma_lifecycle_notes TEXT;

-- Create proforma invoice lifecycle timeline table
CREATE TABLE IF NOT EXISTS proforma_lifecycle_timeline (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT valid_proforma_status CHECK (
    status IN (
      'created',
      'sent',
      'waiting_for_response',
      'customer_responded_price_change',
      'agreed_to_customer_price',
      'did_not_agree',
      'sale_made',
      'converted_to_tax_invoice',
      'cancelled'
    )
  )
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_proforma_lifecycle_invoice_id 
  ON proforma_lifecycle_timeline(invoice_id);

CREATE INDEX IF NOT EXISTS idx_proforma_lifecycle_created_at 
  ON proforma_lifecycle_timeline(created_at DESC);

-- Add comments
COMMENT ON COLUMN invoices.proforma_lifecycle_status IS 'Current lifecycle status for proforma invoices';
COMMENT ON COLUMN invoices.proforma_lifecycle_notes IS 'Latest notes/description for proforma invoice lifecycle';
COMMENT ON TABLE proforma_lifecycle_timeline IS 'Complete timeline of lifecycle changes for proforma invoices';

