-- Migration 084: Tax Provisions
-- Creates tables for managing current tax and deferred tax provisions

-- Tax Provisions
CREATE TABLE IF NOT EXISTS tax_provisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    financial_year VARCHAR(9) NOT NULL, -- '2024-2025'
    tax_type VARCHAR(20) NOT NULL CHECK (tax_type IN ('current_tax', 'deferred_tax')),
    tax_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT, -- Tax liability/asset account
    expense_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT, -- Tax expense account (P&L)
    provision_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    paid_amount DECIMAL(15,2) DEFAULT 0,
    balance_amount DECIMAL(15,2) NOT NULL DEFAULT 0, -- provision_amount - paid_amount
    tax_rate DECIMAL(5,2), -- Applicable tax rate (%)
    taxable_income DECIMAL(15,2), -- Profit before tax
    calculation_method VARCHAR(50), -- 'flat_rate', 'slab_based', 'custom'
    calculation_details JSONB, -- Store calculation parameters
    due_date DATE,
    payment_status VARCHAR(20) DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    UNIQUE(business_id, financial_year, tax_type)
);

-- Tax Payments
CREATE TABLE IF NOT EXISTS tax_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    tax_provision_id UUID REFERENCES tax_provisions(id) ON DELETE CASCADE,
    payment_date DATE NOT NULL,
    payment_amount DECIMAL(15,2) NOT NULL,
    payment_mode VARCHAR(50), -- 'online', 'cheque', 'cash', etc.
    challan_number VARCHAR(100),
    bank_name VARCHAR(255),
    reference_number VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- Deferred Tax Details (for deferred tax calculations)
CREATE TABLE IF NOT EXISTS deferred_tax_details (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    financial_year VARCHAR(9) NOT NULL,
    timing_difference_type VARCHAR(50), -- 'depreciation', 'provisions', 'revenue_recognition', etc.
    book_value DECIMAL(15,2) NOT NULL,
    tax_value DECIMAL(15,2) NOT NULL,
    difference DECIMAL(15,2) NOT NULL, -- book_value - tax_value
    tax_rate DECIMAL(5,2) NOT NULL,
    deferred_tax_amount DECIMAL(15,2) NOT NULL, -- difference * tax_rate
    is_asset BOOLEAN DEFAULT false, -- true for DTA, false for DTL
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tax_provisions_business_id ON tax_provisions(business_id);
CREATE INDEX IF NOT EXISTS idx_tax_provisions_financial_year ON tax_provisions(financial_year);
CREATE INDEX IF NOT EXISTS idx_tax_provisions_tax_type ON tax_provisions(tax_type);
CREATE INDEX IF NOT EXISTS idx_tax_payments_tax_provision_id ON tax_payments(tax_provision_id);
CREATE INDEX IF NOT EXISTS idx_deferred_tax_details_business_id ON deferred_tax_details(business_id);
CREATE INDEX IF NOT EXISTS idx_deferred_tax_details_financial_year ON deferred_tax_details(financial_year);

-- Comments
COMMENT ON TABLE tax_provisions IS 'Current tax and deferred tax provisions for each financial year';
COMMENT ON TABLE tax_payments IS 'Tax payment records against provisions';
COMMENT ON TABLE deferred_tax_details IS 'Detailed deferred tax calculations based on timing differences';

