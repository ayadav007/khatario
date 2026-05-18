-- Migration 085: Contingent Liabilities
-- Creates table for managing contingent liabilities disclosures

-- Contingent Liabilities
CREATE TABLE IF NOT EXISTS contingent_liabilities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    financial_year VARCHAR(9) NOT NULL, -- '2024-2025'
    description TEXT NOT NULL,
    category VARCHAR(100), -- 'litigation', 'guarantees', 'bills_discounted', 'customs_duty', 'others'
    estimated_amount DECIMAL(15,2),
    probability VARCHAR(20) CHECK (probability IN ('probable', 'possible', 'remote')),
    nature TEXT, -- Detailed nature of the contingent liability
    reference_number VARCHAR(100),
    related_party_name VARCHAR(255), -- If related to related party
    disclosure_required BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contingent_liabilities_business_id ON contingent_liabilities(business_id);
CREATE INDEX IF NOT EXISTS idx_contingent_liabilities_financial_year ON contingent_liabilities(financial_year);
CREATE INDEX IF NOT EXISTS idx_contingent_liabilities_category ON contingent_liabilities(category);

-- Comments
COMMENT ON TABLE contingent_liabilities IS 'Contingent liabilities for Balance Sheet disclosures as per Ind AS';

