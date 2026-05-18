-- Migration 110: Invoice Extraction Jobs Table
-- Tracks invoice extraction requests and stores results

CREATE TABLE IF NOT EXISTS invoice_extraction_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    document_attachment_id UUID REFERENCES document_attachments(id) ON DELETE SET NULL,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50),
    status VARCHAR(20) DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed', 'partial')),
    extraction_data JSONB,
    extraction_method VARCHAR(255), -- e.g. 'groq-vision/meta-llama/llama-4-scout-17b-16e-instruct'
    error_message TEXT,
    processing_time_ms INTEGER,
    extracted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_business ON invoice_extraction_jobs(business_id);
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_status ON invoice_extraction_jobs(status);
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_created_at ON invoice_extraction_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_document ON invoice_extraction_jobs(document_attachment_id);

-- Add trigger to update updated_at
CREATE TRIGGER update_invoice_extraction_jobs_updated_at
    BEFORE UPDATE ON invoice_extraction_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments
COMMENT ON TABLE invoice_extraction_jobs IS 'Tracks invoice extraction jobs and stores results';
COMMENT ON COLUMN invoice_extraction_jobs.extraction_data IS 'JSONB containing extracted invoice data (supplier, invoice details, items, totals)';
COMMENT ON COLUMN invoice_extraction_jobs.extraction_method IS 'Method used for extraction: template, ocr_template, generic, ocr';
COMMENT ON COLUMN invoice_extraction_jobs.status IS 'Job status: processing, completed, failed, partial';
