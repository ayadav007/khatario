-- Migration 086: Related Party Transactions
-- Creates table for managing related party transactions disclosures

-- Related Parties Master
CREATE TABLE IF NOT EXISTS related_parties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    party_name VARCHAR(255) NOT NULL,
    party_type VARCHAR(50) NOT NULL CHECK (party_type IN (
        'director',
        'key_management_personnel',
        'relative_of_director',
        'subsidiary',
        'associate',
        'joint_venture',
        'entity_under_common_control',
        'others'
    )),
    relationship_description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, party_name)
);

-- Related Party Transactions
CREATE TABLE IF NOT EXISTS related_party_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    financial_year VARCHAR(9) NOT NULL, -- '2024-2025'
    related_party_id UUID REFERENCES related_parties(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN (
        'purchase',
        'sale',
        'service',
        'rent',
        'loan',
        'guarantee',
        'investment',
        'remuneration',
        'others'
    )),
    transaction_date DATE NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    description TEXT,
    reference_type VARCHAR(50), -- 'invoice', 'purchase', 'payment', 'expense', etc.
    reference_id UUID,
    outstanding_amount DECIMAL(15,2) DEFAULT 0, -- Outstanding as on balance sheet date
    terms_and_conditions TEXT,
    disclosure_required BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_related_parties_business_id ON related_parties(business_id);
CREATE INDEX IF NOT EXISTS idx_related_party_transactions_business_id ON related_party_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_related_party_transactions_financial_year ON related_party_transactions(financial_year);
CREATE INDEX IF NOT EXISTS idx_related_party_transactions_related_party_id ON related_party_transactions(related_party_id);
CREATE INDEX IF NOT EXISTS idx_related_party_transactions_transaction_type ON related_party_transactions(transaction_type);

-- Comments
COMMENT ON TABLE related_parties IS 'Master list of related parties for the business';
COMMENT ON TABLE related_party_transactions IS 'Related party transactions for Balance Sheet disclosures as per Ind AS';

