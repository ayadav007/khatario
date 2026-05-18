-- Migration 076: Unified Document Attachments Table
-- Creates a generic document attachments table that can be used across all modules
-- Supports: invoices, purchases, credit_notes, purchase_returns, journal_entries, expenses, customers, suppliers

CREATE TABLE IF NOT EXISTS document_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN (
        'invoice', 'purchase', 'credit_note', 'purchase_return', 
        'journal_entry', 'expense', 'customer', 'supplier'
    )),
    entity_id UUID NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_type VARCHAR(50), -- 'pdf', 'image', 'document', 'spreadsheet', etc.
    file_size INTEGER, -- Size in bytes
    mime_type VARCHAR(100), -- Full MIME type (e.g., 'application/pdf', 'image/jpeg')
    description TEXT, -- Optional description/notes
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_document_attachments_entity ON document_attachments(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_document_attachments_business ON document_attachments(business_id);
CREATE INDEX IF NOT EXISTS idx_document_attachments_uploaded_by ON document_attachments(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_document_attachments_created_at ON document_attachments(created_at DESC);

-- Add trigger to update updated_at
CREATE TRIGGER update_document_attachments_updated_at
    BEFORE UPDATE ON document_attachments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Migrate existing journal_entry_attachments to unified table (if tables exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entry_attachments')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entries')
    THEN
        INSERT INTO document_attachments (
            business_id, entity_type, entity_id, file_name, file_url, 
            file_type, file_size, mime_type, uploaded_by, created_at
        )
        SELECT 
            je.business_id,
            'journal_entry' as entity_type,
            jea.journal_entry_id as entity_id,
            jea.file_name,
            jea.file_url,
            jea.file_type,
            jea.file_size,
            CASE 
                WHEN jea.file_type = 'pdf' THEN 'application/pdf'
                WHEN jea.file_type = 'image' THEN 'image/jpeg'
                ELSE 'application/octet-stream'
            END as mime_type,
            jea.uploaded_by,
            jea.created_at
        FROM journal_entry_attachments jea
        JOIN journal_entries je ON jea.journal_entry_id = je.voucher_id
        WHERE NOT EXISTS (
            SELECT 1 FROM document_attachments da 
            WHERE da.entity_type = 'journal_entry' 
            AND da.entity_id = jea.journal_entry_id
            AND da.file_name = jea.file_name
        );
    END IF;
END $$;

-- Migrate existing expense_attachments to unified table (if tables exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'expense_attachments')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_expenses')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_expenses' AND column_name = 'business_id')
    THEN
        INSERT INTO document_attachments (
            business_id, entity_type, entity_id, file_name, file_url, 
            file_type, file_size, mime_type, uploaded_by, created_at
        )
        SELECT 
            ee.business_id,
            'expense' as entity_type,
            ea.expense_id as entity_id,
            ea.file_name,
            ea.file_url,
            ea.file_type,
            ea.file_size,
            CASE 
                WHEN ea.file_type = 'receipt' THEN 'image/jpeg'
                WHEN ea.file_type = 'invoice' THEN 'application/pdf'
                ELSE 'application/octet-stream'
            END as mime_type,
            NULL as uploaded_by, -- expense_attachments doesn't have uploaded_by
            ea.uploaded_at as created_at
        FROM expense_attachments ea
        JOIN employee_expenses ee ON ea.expense_id = ee.id
        WHERE NOT EXISTS (
            SELECT 1 FROM document_attachments da 
            WHERE da.entity_type = 'expense' 
            AND da.entity_id = ea.expense_id
            AND da.file_name = ea.file_name
        );
    END IF;
END $$;

-- Add comments
COMMENT ON TABLE document_attachments IS 'Unified table for storing document attachments across all modules';
COMMENT ON COLUMN document_attachments.entity_type IS 'Type of entity this attachment belongs to';
COMMENT ON COLUMN document_attachments.entity_id IS 'ID of the entity (invoice_id, purchase_id, etc.)';
COMMENT ON COLUMN document_attachments.file_url IS 'URL or path to the uploaded file (currently base64 data URL, can be extended to cloud storage)';

