-- Migration: Template assignments per document type
-- Purpose: Allow different templates for different document types per business
-- Date: 2026-01-02

-- Create template assignments table
CREATE TABLE IF NOT EXISTS business_template_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  document_type VARCHAR(50) NOT NULL,
  template_id VARCHAR(100) NOT NULL,
  settings JSONB DEFAULT '{}',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_business_document_template UNIQUE(business_id, document_type)
);

-- Valid document types:
-- 'tax_invoice', 'proforma_invoice', 'bill_of_supply', 'export_invoice'
-- 'credit_note', 'debit_note', 'delivery_challan'
-- 'sales_order', 'purchase_order', 'work_order'

COMMENT ON TABLE business_template_assignments 
IS 'Stores template assignments per document type per business';

COMMENT ON COLUMN business_template_assignments.document_type 
IS 'Type of document: tax_invoice, proforma_invoice, bill_of_supply, credit_note, debit_note, delivery_challan, sales_order, purchase_order, work_order';

COMMENT ON COLUMN business_template_assignments.template_id 
IS 'Template identifier from template registry (e.g., gst_standard, bill_of_supply/composition_standard)';

COMMENT ON COLUMN business_template_assignments.settings 
IS 'JSONB object containing template-specific settings (show/hide fields, colors, etc.)';

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_template_assignments_business 
ON business_template_assignments(business_id);

CREATE INDEX IF NOT EXISTS idx_template_assignments_doctype 
ON business_template_assignments(document_type);

CREATE INDEX IF NOT EXISTS idx_template_assignments_template 
ON business_template_assignments(template_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_template_assignments_updated_at ON business_template_assignments;
CREATE TRIGGER update_template_assignments_updated_at 
BEFORE UPDATE ON business_template_assignments
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Migrate existing template settings from invoice_template_settings table
-- This will set default templates for all businesses
INSERT INTO business_template_assignments (business_id, document_type, template_id, settings)
SELECT 
  business_id,
  'tax_invoice' as document_type,
  COALESCE(template_id, 'gst_standard') as template_id,
  to_jsonb(its) as settings
FROM invoice_template_settings its
ON CONFLICT (business_id, document_type) DO NOTHING;

