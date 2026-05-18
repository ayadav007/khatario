-- Migration 065: TDS/TCS Management
-- Creates tables for TDS (Tax Deducted at Source) and TCS (Tax Collected at Source) management

-- TDS Categories (Sections like 194A, 194C, etc.)
CREATE TABLE IF NOT EXISTS tds_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    section_code VARCHAR(20) NOT NULL, -- '194A', '194C', '194H', etc.
    section_name VARCHAR(255) NOT NULL,
    description TEXT,
    rate DECIMAL(5,2) NOT NULL, -- TDS rate percentage
    threshold_amount DECIMAL(12,2) DEFAULT 0, -- Threshold above which TDS applies
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, section_code)
);

-- TDS Transactions (TDS deducted on payments)
CREATE TABLE IF NOT EXISTS tds_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    tds_category_id UUID REFERENCES tds_categories(id) ON DELETE RESTRICT,
    section_code VARCHAR(20) NOT NULL,
    payment_amount DECIMAL(12,2) NOT NULL,
    tds_rate DECIMAL(5,2) NOT NULL,
    tds_amount DECIMAL(12,2) NOT NULL,
    net_payment_amount DECIMAL(12,2) NOT NULL, -- Payment amount after TDS
    transaction_date DATE NOT NULL,
    financial_year VARCHAR(9) NOT NULL, -- '2024-2025'
    quarter VARCHAR(2) NOT NULL, -- 'Q1', 'Q2', 'Q3', 'Q4'
    challan_number VARCHAR(100), -- TDS challan number
    challan_date DATE,
    is_deposited BOOLEAN DEFAULT false,
    deposited_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- TDS Payments (TDS deposited to government)
CREATE TABLE IF NOT EXISTS tds_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    financial_year VARCHAR(9) NOT NULL,
    quarter VARCHAR(2) NOT NULL,
    challan_number VARCHAR(100) NOT NULL,
    challan_date DATE NOT NULL,
    deposit_date DATE NOT NULL,
    total_tds_amount DECIMAL(12,2) NOT NULL,
    bank_name VARCHAR(255),
    payment_mode VARCHAR(50), -- 'online', 'challan', 'neft', 'rtgs'
    payment_reference VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'deposited', 'verified'
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- TDS Certificates (Form 16A issued to suppliers)
CREATE TABLE IF NOT EXISTS tds_certificates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
    financial_year VARCHAR(9) NOT NULL,
    quarter VARCHAR(2) NOT NULL,
    certificate_number VARCHAR(100) NOT NULL,
    issue_date DATE NOT NULL,
    total_tds_amount DECIMAL(12,2) NOT NULL,
    file_url TEXT, -- PDF certificate URL
    is_issued BOOLEAN DEFAULT false,
    issued_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    UNIQUE(business_id, supplier_id, financial_year, quarter)
);

-- TCS Categories (Tax Collected at Source)
CREATE TABLE IF NOT EXISTS tcs_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    section_code VARCHAR(20) NOT NULL,
    section_name VARCHAR(255) NOT NULL,
    description TEXT,
    rate DECIMAL(5,2) NOT NULL,
    threshold_amount DECIMAL(12,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, section_code)
);

-- TCS Transactions (TCS collected on sales)
CREATE TABLE IF NOT EXISTS tcs_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    tcs_category_id UUID REFERENCES tcs_categories(id) ON DELETE RESTRICT,
    section_code VARCHAR(20) NOT NULL,
    invoice_amount DECIMAL(12,2) NOT NULL,
    tcs_rate DECIMAL(5,2) NOT NULL,
    tcs_amount DECIMAL(12,2) NOT NULL,
    transaction_date DATE NOT NULL,
    financial_year VARCHAR(9) NOT NULL,
    quarter VARCHAR(2) NOT NULL,
    challan_number VARCHAR(100),
    challan_date DATE,
    is_deposited BOOLEAN DEFAULT false,
    deposited_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tds_categories_business_id ON tds_categories(business_id);
CREATE INDEX IF NOT EXISTS idx_tds_transactions_business_id ON tds_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_tds_transactions_supplier_id ON tds_transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_tds_transactions_fy_quarter ON tds_transactions(financial_year, quarter);
CREATE INDEX IF NOT EXISTS idx_tds_payments_fy_quarter ON tds_payments(financial_year, quarter);
CREATE INDEX IF NOT EXISTS idx_tds_certificates_supplier_id ON tds_certificates(supplier_id);
CREATE INDEX IF NOT EXISTS idx_tcs_transactions_business_id ON tcs_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_tcs_transactions_customer_id ON tcs_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_tcs_transactions_fy_quarter ON tcs_transactions(financial_year, quarter);

COMMENT ON TABLE tds_categories IS 'TDS sections with rates and thresholds';
COMMENT ON TABLE tds_transactions IS 'TDS deducted on supplier payments';
COMMENT ON TABLE tds_payments IS 'TDS deposited to government';
COMMENT ON TABLE tds_certificates IS 'TDS certificates (Form 16A) issued to suppliers';
COMMENT ON TABLE tcs_categories IS 'TCS sections with rates and thresholds';
COMMENT ON TABLE tcs_transactions IS 'TCS collected on customer invoices';

