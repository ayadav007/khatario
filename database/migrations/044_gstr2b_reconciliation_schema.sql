-- GSTR-2B Reconciliation Workspace Schema
-- GST-law compliant reconciliation system for ITC matching
-- NO auto-adjustments - all decisions require user input

-- Table 1: GSTR-2B Import Records
-- Stores imported GSTR-2B data from GST portal
CREATE TABLE IF NOT EXISTS gstr2b_imports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    filing_period VARCHAR(7) NOT NULL, -- Format: YYYY-MM (e.g., 2024-04)
    import_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    import_type VARCHAR(20) NOT NULL DEFAULT 'json', -- 'json' or 'excel'
    file_name VARCHAR(255),
    file_hash VARCHAR(64), -- To prevent duplicate imports
    total_invoices INTEGER DEFAULT 0,
    total_itc DECIMAL(15,2) DEFAULT 0,
    imported_by UUID REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_import_period UNIQUE (business_id, filing_period, file_hash)
);

CREATE INDEX idx_gstr2b_imports_business_period ON gstr2b_imports(business_id, filing_period);

-- Table 2: GSTR-2B Invoice Data (Read-only, from portal)
-- Stores actual GSTR-2B invoice records
CREATE TABLE IF NOT EXISTS gstr2b_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    import_id UUID NOT NULL REFERENCES gstr2b_imports(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- Invoice Identification
    supplier_gstin VARCHAR(15) NOT NULL,
    supplier_name VARCHAR(255),
    invoice_number VARCHAR(50) NOT NULL,
    invoice_date DATE NOT NULL,
    document_type VARCHAR(20) NOT NULL, -- 'invoice', 'credit_note', 'debit_note'
    
    -- Tax Details (from GSTR-2B)
    taxable_value DECIMAL(15,2) DEFAULT 0,
    igst_amount DECIMAL(15,2) DEFAULT 0,
    cgst_amount DECIMAL(15,2) DEFAULT 0,
    sgst_amount DECIMAL(15,2) DEFAULT 0,
    cess_amount DECIMAL(15,2) DEFAULT 0,
    
    -- ITC Eligibility (from portal)
    itc_eligibility VARCHAR(20) DEFAULT 'eligible', -- 'eligible', 'ineligible', 'blocked'
    itc_reversal_type VARCHAR(50), -- If ineligible, reason (e.g., 'section_17_5', 'blocked_credit')
    
    -- Additional GSTR-2B fields
    place_of_supply VARCHAR(2),
    reverse_charge VARCHAR(1) DEFAULT 'N', -- 'Y' or 'N'
    original_invoice_number VARCHAR(50), -- For credit/debit notes
    original_invoice_date DATE, -- For credit/debit notes
    
    -- Metadata
    filing_period VARCHAR(7) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_2b_invoice UNIQUE (import_id, supplier_gstin, invoice_number, invoice_date, document_type)
);

CREATE INDEX idx_gstr2b_invoices_business_period ON gstr2b_invoices(business_id, filing_period);
CREATE INDEX idx_gstr2b_invoices_supplier_invoice ON gstr2b_invoices(supplier_gstin, invoice_number, invoice_date);

-- Table 3: Purchase Register Items (for reconciliation)
-- Links purchase_items to reconciliation records
-- This is a view/helper table structure - we'll query purchase_items directly
-- but store reconciliation metadata here

-- Table 4: Reconciliation Records
-- Stores the matching results and user decisions
CREATE TABLE IF NOT EXISTS gstr2b_reconciliation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    filing_period VARCHAR(7) NOT NULL,
    
    -- Source References
    purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
    purchase_item_id UUID REFERENCES purchase_items(id) ON DELETE SET NULL,
    gstr2b_invoice_id UUID REFERENCES gstr2b_invoices(id) ON DELETE SET NULL,
    
    -- Matching Status
    match_status VARCHAR(30) NOT NULL, 
    -- Values: 'MATCHED', 'PARTIALLY_MATCHED', 'MISSING_IN_2B', 'ONLY_IN_2B', 'NOT_ELIGIBLE'
    
    -- Invoice Details (denormalized for quick access)
    supplier_gstin VARCHAR(15) NOT NULL,
    invoice_number VARCHAR(50) NOT NULL,
    invoice_date DATE NOT NULL,
    document_type VARCHAR(20) DEFAULT 'invoice',
    
    -- Books Values (from purchase register)
    books_taxable_value DECIMAL(15,2) DEFAULT 0,
    books_igst DECIMAL(15,2) DEFAULT 0,
    books_cgst DECIMAL(15,2) DEFAULT 0,
    books_sgst DECIMAL(15,2) DEFAULT 0,
    books_cess DECIMAL(15,2) DEFAULT 0,
    books_itc_amount DECIMAL(15,2) DEFAULT 0,
    
    -- GSTR-2B Values (from portal)
    gstr2b_taxable_value DECIMAL(15,2) DEFAULT 0,
    gstr2b_igst DECIMAL(15,2) DEFAULT 0,
    gstr2b_cgst DECIMAL(15,2) DEFAULT 0,
    gstr2b_sgst DECIMAL(15,2) DEFAULT 0,
    gstr2b_cess DECIMAL(15,2) DEFAULT 0,
    gstr2b_itc_eligibility VARCHAR(20),
    
    -- Difference Calculation
    difference_taxable_value DECIMAL(15,2) DEFAULT 0,
    difference_igst DECIMAL(15,2) DEFAULT 0,
    difference_cgst DECIMAL(15,2) DEFAULT 0,
    difference_sgst DECIMAL(15,2) DEFAULT 0,
    difference_cess DECIMAL(15,2) DEFAULT 0,
    
    -- Special Cases
    is_import_goods BOOLEAN DEFAULT false,
    is_import_services BOOLEAN DEFAULT false,
    is_credit_note BOOLEAN DEFAULT false,
    linked_invoice_id UUID, -- For credit notes linking to original invoice
    
    -- Timestamps
    matched_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_match_status CHECK (match_status IN ('MATCHED', 'PARTIALLY_MATCHED', 'MISSING_IN_2B', 'ONLY_IN_2B', 'NOT_ELIGIBLE')),
    
    -- Unique constraint to prevent duplicates (invoice-level reconciliation)
    CONSTRAINT unique_reconciliation_invoice UNIQUE (business_id, filing_period, supplier_gstin, invoice_number, invoice_date, document_type)
);

CREATE INDEX idx_reconciliation_business_period ON gstr2b_reconciliation(business_id, filing_period);
CREATE INDEX idx_reconciliation_status ON gstr2b_reconciliation(match_status);
CREATE INDEX idx_reconciliation_supplier_invoice ON gstr2b_reconciliation(supplier_gstin, invoice_number, invoice_date);

-- Table 5: User Decisions (AUDIT TRAIL)
-- Stores all user decisions for non-matched invoices
CREATE TABLE IF NOT EXISTS reconciliation_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reconciliation_id UUID NOT NULL REFERENCES gstr2b_reconciliation(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- Decision Details
    decision VARCHAR(50) NOT NULL,
    -- Values: 'PENDING_SUPPLIER_CORRECTION', 'ITC_ELIGIBLE_THIS_PERIOD', 
    --         'ITC_DEFERRED_TO_FUTURE', 'ITC_NOT_ELIGIBLE', 'IGNORE'
    
    decision_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by_user_id UUID NOT NULL REFERENCES users(id),
    remarks TEXT,
    
    -- ITC Amount (if eligible)
    eligible_itc_amount DECIMAL(15,2) DEFAULT 0,
    deferred_to_period VARCHAR(7), -- If deferred, target period (YYYY-MM)
    
    -- Audit Fields
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_decision CHECK (decision IN (
        'PENDING_SUPPLIER_CORRECTION', 
        'ITC_ELIGIBLE_THIS_PERIOD', 
        'ITC_DEFERRED_TO_FUTURE', 
        'ITC_NOT_ELIGIBLE', 
        'IGNORE'
    )),
    
    -- One decision per reconciliation record
    CONSTRAINT unique_reconciliation_decision UNIQUE (reconciliation_id)
);

CREATE INDEX idx_decisions_reconciliation ON reconciliation_decisions(reconciliation_id);
CREATE INDEX idx_decisions_business_period ON reconciliation_decisions(business_id, decision_date);
CREATE INDEX idx_decisions_eligible ON reconciliation_decisions(decision) WHERE decision = 'ITC_ELIGIBLE_THIS_PERIOD';

-- Table 6: Reconciliation Summary (computed view helper)
-- This can be a materialized view or computed on-the-fly
-- Stores period-wise summary for quick access

COMMENT ON TABLE gstr2b_imports IS 'GSTR-2B data imports from GST portal. Read-only source data.';
COMMENT ON TABLE gstr2b_invoices IS 'Individual invoice records from GSTR-2B. Source of truth for ITC eligibility.';
COMMENT ON TABLE gstr2b_reconciliation IS 'Reconciliation matching results between books and GSTR-2B. No auto-adjustments.';
COMMENT ON TABLE reconciliation_decisions IS 'User decisions for reconciliation mismatches. Full audit trail for compliance.';

