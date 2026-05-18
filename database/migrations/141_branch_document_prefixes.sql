-- Migration 141: Branch Document Prefixes per Document Type
-- Purpose: Allow each branch to have different prefixes for different document types
-- This enables branches to have custom prefixes like "INV-MUM" for Tax Invoice, "PI-MUM" for Proforma Invoice, etc.

-- Create branch_document_prefixes table
CREATE TABLE IF NOT EXISTS branch_document_prefixes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  document_type VARCHAR(50) NOT NULL, -- 'tax_invoice', 'proforma_invoice', 'bill_of_supply', 'sales_order', etc.
  prefix VARCHAR(50) NOT NULL, -- Custom prefix for this document type (e.g., 'INV-MUM', 'PI-MUM')
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(branch_id, document_type)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_branch_document_prefixes_branch_doc_type 
ON branch_document_prefixes(branch_id, document_type);

-- Add comment
COMMENT ON TABLE branch_document_prefixes IS 'Stores custom prefixes per document type per branch. If not set, uses document type default prefix from DOCUMENT_RULES.';
COMMENT ON COLUMN branch_document_prefixes.document_type IS 'Document type: tax_invoice, proforma_invoice, bill_of_supply, sales_order, delivery_challan, credit_note, debit_note, purchase_order, work_order';
COMMENT ON COLUMN branch_document_prefixes.prefix IS 'Custom prefix for this document type at this branch (e.g., INV-MUM, PI-MUM)';
