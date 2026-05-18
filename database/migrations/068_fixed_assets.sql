-- Migration 068: Fixed Assets & Depreciation
-- Creates tables for fixed assets register and depreciation management

-- Fixed Assets
CREATE TABLE IF NOT EXISTS fixed_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    asset_code VARCHAR(100) NOT NULL,
    asset_name VARCHAR(255) NOT NULL,
    asset_category VARCHAR(100), -- 'Machinery', 'Vehicle', 'Building', 'Furniture', etc.
    purchase_date DATE NOT NULL,
    purchase_cost DECIMAL(15,2) NOT NULL,
    account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT, -- Fixed Assets account
    depreciation_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT, -- Depreciation expense account
    depreciation_method VARCHAR(10) NOT NULL CHECK (depreciation_method IN ('SLM', 'WDV')), -- Straight Line Method or Written Down Value
    useful_life_years INTEGER NOT NULL, -- Useful life in years
    depreciation_rate DECIMAL(5,2), -- Annual depreciation rate (%)
    residual_value DECIMAL(15,2) DEFAULT 0, -- Scrap/residual value
    current_book_value DECIMAL(15,2) NOT NULL, -- Current written down value
    accumulated_depreciation DECIMAL(15,2) DEFAULT 0,
    location VARCHAR(255), -- Asset location
    vendor_name VARCHAR(255),
    invoice_number VARCHAR(100),
    warranty_expiry_date DATE,
    is_disposed BOOLEAN DEFAULT false,
    disposal_date DATE,
    disposal_amount DECIMAL(15,2),
    disposal_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, asset_code)
);

-- Depreciation Schedule
CREATE TABLE IF NOT EXISTS depreciation_schedule (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES fixed_assets(id) ON DELETE CASCADE,
    financial_year VARCHAR(9) NOT NULL,
    period_start_date DATE NOT NULL,
    period_end_date DATE NOT NULL,
    opening_book_value DECIMAL(15,2) NOT NULL,
    depreciation_amount DECIMAL(15,2) NOT NULL,
    closing_book_value DECIMAL(15,2) NOT NULL,
    is_posted BOOLEAN DEFAULT false,
    posted_date DATE,
    journal_entry_id UUID, -- Reference to journal entry if posted
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Asset Disposals
CREATE TABLE IF NOT EXISTS asset_disposals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES fixed_assets(id) ON DELETE CASCADE,
    disposal_date DATE NOT NULL,
    disposal_amount DECIMAL(15,2) NOT NULL,
    disposal_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    reason TEXT,
    buyer_name VARCHAR(255),
    journal_entry_id UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fixed_assets_business_id ON fixed_assets(business_id);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_account_id ON fixed_assets(account_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_schedule_asset_id ON depreciation_schedule(asset_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_schedule_fy ON depreciation_schedule(financial_year);
CREATE INDEX IF NOT EXISTS idx_asset_disposals_asset_id ON asset_disposals(asset_id);

COMMENT ON TABLE fixed_assets IS 'Fixed assets register';
COMMENT ON TABLE depreciation_schedule IS 'Depreciation calculations for each period';
COMMENT ON TABLE asset_disposals IS 'Asset disposal records';

