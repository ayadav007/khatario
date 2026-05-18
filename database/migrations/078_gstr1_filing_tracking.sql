-- GSTR-1 Filing Tracking Schema
-- Tracks GSTR-1 filings and locks invoices after filing (Zoho-style)

-- Table 1: GSTR-1 Filing Records
CREATE TABLE IF NOT EXISTS gstr1_filings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    filing_period VARCHAR(7) NOT NULL, -- Format: YYYY-MM (e.g., 2025-12)
    filing_date DATE NOT NULL, -- Date when GSTR-1 was filed on GST portal
    status VARCHAR(20) DEFAULT 'draft', -- 'draft', 'filed', 'cancelled'
    lock_date DATE, -- Date up to which invoices should be locked (Zoho-style)
    json_file_path TEXT,
    excel_file_path TEXT,
    notes TEXT,
    filed_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_filing_period UNIQUE (business_id, filing_period)
);

-- Table 2: GSTR-1 Filing Invoices (Junction Table)
-- Links invoices to GSTR-1 filings
CREATE TABLE IF NOT EXISTS gstr1_filing_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gstr1_filing_id UUID NOT NULL REFERENCES gstr1_filings(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_filing_invoice UNIQUE (gstr1_filing_id, invoice_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_gstr1_filings_business_period ON gstr1_filings(business_id, filing_period);
CREATE INDEX IF NOT EXISTS idx_gstr1_filings_status ON gstr1_filings(status);
CREATE INDEX IF NOT EXISTS idx_gstr1_filing_invoices_invoice ON gstr1_filing_invoices(invoice_id);
CREATE INDEX IF NOT EXISTS idx_gstr1_filing_invoices_filing ON gstr1_filing_invoices(gstr1_filing_id);

-- Comments
COMMENT ON TABLE gstr1_filings IS 'Stores GSTR-1 filing records with period, status, and lock date';
COMMENT ON TABLE gstr1_filing_invoices IS 'Junction table linking invoices to GSTR-1 filings';
COMMENT ON COLUMN gstr1_filings.filing_period IS 'Format: YYYY-MM (e.g., 2025-12)';
COMMENT ON COLUMN gstr1_filings.status IS 'draft: Generated but not filed, filed: Marked as filed and invoices locked';
COMMENT ON COLUMN gstr1_filings.lock_date IS 'Date up to which invoices should be locked (Zoho-style date-based locking)';

