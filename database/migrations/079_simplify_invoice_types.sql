-- Simplify Invoice Types (Zoho-style approach)
-- Remove retail_invoice and export_invoice as separate types
-- Use tax_invoice with template_id for retail, and is_export flag for exports

-- Step 1: Add is_export field
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS is_export BOOLEAN DEFAULT false;

-- Step 2: Migrate existing export_invoice records to tax_invoice with is_export=true
UPDATE invoices 
SET is_export = true, 
    document_type = 'tax_invoice'
WHERE document_type = 'export_invoice';

-- Step 3: Migrate existing retail_invoice records to tax_invoice
-- Set template_id to 'retail' if not already set
UPDATE invoices 
SET document_type = 'tax_invoice',
    template_id = COALESCE(NULLIF(template_id, ''), 'retail')
WHERE document_type = 'retail_invoice'
  AND (template_id IS NULL OR template_id = '');

-- Step 4: Add comment
COMMENT ON COLUMN invoices.is_export IS 'True if this is an export invoice (requires shipping bill, port code, etc.)';

-- Step 5: Update invoice number counters if needed
-- Note: This assumes separate counters exist for different document types
-- If you have separate counters, you may want to merge them

