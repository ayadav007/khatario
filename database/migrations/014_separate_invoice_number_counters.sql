-- Migration: Separate Invoice Number Counters per Document Type
-- Purpose: Add separate counters for each invoice document type to enable different prefixes and numbering sequences

-- Add new counter columns for each document type
ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS next_tax_invoice_number INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS next_retail_invoice_number INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS next_proforma_invoice_number INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS next_export_invoice_number INTEGER DEFAULT 1;

-- Initialize counters based on existing invoice numbers
-- This ensures existing invoices don't cause duplicate numbers
DO $$
DECLARE
    business_record RECORD;
    tax_count INTEGER;
    retail_count INTEGER;
    proforma_count INTEGER;
    export_count INTEGER;
BEGIN
    FOR business_record IN SELECT id FROM businesses LOOP
        -- Count existing invoices by document_type (or default to tax_invoice if null)
        SELECT COALESCE(MAX(
            CASE 
                WHEN document_type IS NULL OR document_type = 'tax_invoice' OR document_type = 'regular' 
                THEN CAST(SUBSTRING(invoice_number FROM '(\d+)$') AS INTEGER)
                ELSE NULL
            END
        ), 0) INTO tax_count
        FROM invoices
        WHERE business_id = business_record.id;

        SELECT COALESCE(MAX(
            CASE 
                WHEN document_type = 'retail_invoice'
                THEN CAST(SUBSTRING(invoice_number FROM '(\d+)$') AS INTEGER)
                ELSE NULL
            END
        ), 0) INTO retail_count
        FROM invoices
        WHERE business_id = business_record.id;

        SELECT COALESCE(MAX(
            CASE 
                WHEN document_type = 'proforma_invoice'
                THEN CAST(SUBSTRING(invoice_number FROM '(\d+)$') AS INTEGER)
                ELSE NULL
            END
        ), 0) INTO proforma_count
        FROM invoices
        WHERE business_id = business_record.id;

        SELECT COALESCE(MAX(
            CASE 
                WHEN document_type = 'export_invoice'
                THEN CAST(SUBSTRING(invoice_number FROM '(\d+)$') AS INTEGER)
                ELSE NULL
            END
        ), 0) INTO export_count
        FROM invoices
        WHERE business_id = business_record.id;

        -- Set counters to max + 1 (next available number)
        UPDATE businesses
        SET 
            next_tax_invoice_number = GREATEST(tax_count + 1, 1),
            next_retail_invoice_number = GREATEST(retail_count + 1, 1),
            next_proforma_invoice_number = GREATEST(proforma_count + 1, 1),
            next_export_invoice_number = GREATEST(export_count + 1, 1)
        WHERE id = business_record.id;
    END LOOP;
END $$;

-- Add comments
COMMENT ON COLUMN businesses.next_tax_invoice_number IS 'Next invoice number for tax_invoice/regular invoices (prefix: INV)';
COMMENT ON COLUMN businesses.next_retail_invoice_number IS 'Next invoice number for retail_invoice (prefix: RT)';
COMMENT ON COLUMN businesses.next_proforma_invoice_number IS 'Next invoice number for proforma_invoice (prefix: PI)';
COMMENT ON COLUMN businesses.next_export_invoice_number IS 'Next invoice number for export_invoice (prefix: EXP)';

