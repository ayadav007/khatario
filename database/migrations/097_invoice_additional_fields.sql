-- Migration 097: Add Additional Invoice Fields
-- Purpose: Add e-way bill, purchase order, reference number, round off toggle, and attachments support

-- Add new fields to invoices table
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS eway_bill_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS eway_bill_date DATE,
ADD COLUMN IF NOT EXISTS purchase_order_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS purchase_order_date DATE,
ADD COLUMN IF NOT EXISTS reference_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS enable_round_off BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- Create invoice_attachments table for file storage references
CREATE TABLE IF NOT EXISTS invoice_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    file_type VARCHAR(100),
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_invoice_attachments_invoice_id ON invoice_attachments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_attachments_business_id ON invoice_attachments(business_id);
CREATE INDEX IF NOT EXISTS idx_invoices_eway_bill_number ON invoices(eway_bill_number);
CREATE INDEX IF NOT EXISTS idx_invoices_purchase_order_number ON invoices(purchase_order_number);
CREATE INDEX IF NOT EXISTS idx_invoices_reference_number ON invoices(reference_number);

-- Add comments
COMMENT ON COLUMN invoices.eway_bill_number IS 'E-way bill number for GST compliance';
COMMENT ON COLUMN invoices.eway_bill_date IS 'E-way bill date';
COMMENT ON COLUMN invoices.purchase_order_number IS 'Customer purchase order number';
COMMENT ON COLUMN invoices.purchase_order_date IS 'Purchase order date';
COMMENT ON COLUMN invoices.reference_number IS 'General reference number for the invoice';
COMMENT ON COLUMN invoices.enable_round_off IS 'Whether round off is enabled for this invoice';
COMMENT ON COLUMN invoices.attachments IS 'JSON array of attachment metadata';
COMMENT ON TABLE invoice_attachments IS 'File attachments for invoices';
