-- Phase 3: Create ITC reversals table (optional, for advanced ITC tracking)
-- This enables tracking of ITC reversals for GSTR-3B compliance

CREATE TABLE IF NOT EXISTS itc_reversals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,  -- For credit note reversals
    reversal_reason VARCHAR(100) NOT NULL,  -- e.g., 'non_payment', 'credit_note', 'rule_42', 'rule_43'
    cgst_reversed DECIMAL(12,2) DEFAULT 0,
    sgst_reversed DECIMAL(12,2) DEFAULT 0,
    igst_reversed DECIMAL(12,2) DEFAULT 0,
    reversal_date DATE NOT NULL,
    financial_year VARCHAR(10),  -- e.g., '2024-25'
    tax_period VARCHAR(10),  -- e.g., '042024' for April 2024
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_itc_reversals_business_id ON itc_reversals(business_id);
CREATE INDEX IF NOT EXISTS idx_itc_reversals_purchase_id ON itc_reversals(purchase_id);
CREATE INDEX IF NOT EXISTS idx_itc_reversals_invoice_id ON itc_reversals(invoice_id);
CREATE INDEX IF NOT EXISTS idx_itc_reversals_date ON itc_reversals(reversal_date);
CREATE INDEX IF NOT EXISTS idx_itc_reversals_period ON itc_reversals(tax_period);

-- Add comments
COMMENT ON TABLE itc_reversals IS 'Tracks ITC reversals for compliance (Rules 42, 43 of CGST Rules)';
COMMENT ON COLUMN itc_reversals.reversal_reason IS 'Reason for reversal: non_payment, credit_note, rule_42, rule_43, etc.';
COMMENT ON COLUMN itc_reversals.tax_period IS 'Tax period in format MMyyyy (e.g., 042024 for April 2024)';

