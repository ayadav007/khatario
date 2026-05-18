-- Migration 083: Closing Stock Valuation
-- Creates table for storing closing stock snapshots at financial year end

-- Closing Stock Snapshots
CREATE TABLE IF NOT EXISTS closing_stock_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    financial_year_id UUID REFERENCES financial_years(id) ON DELETE CASCADE,
    financial_year VARCHAR(9) NOT NULL, -- '2024-2025'
    snapshot_date DATE NOT NULL, -- Usually last day of financial year
    item_id UUID REFERENCES items(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES item_variants(id) ON DELETE SET NULL,
    location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    quantity DECIMAL(12,2) NOT NULL,
    unit_cost DECIMAL(12,2) NOT NULL,
    total_value DECIMAL(15,2) NOT NULL,
    valuation_method VARCHAR(20) NOT NULL CHECK (valuation_method IN ('fifo', 'lifo', 'weighted_avg', 'simple')),
    batch_id UUID REFERENCES item_batches(id) ON DELETE SET NULL, -- If batch tracked
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    UNIQUE(business_id, financial_year_id, item_id, variant_id, location_id, batch_id)
);

-- Closing Stock Summary (aggregated view for reporting)
CREATE TABLE IF NOT EXISTS closing_stock_summary (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    financial_year_id UUID REFERENCES financial_years(id) ON DELETE CASCADE,
    financial_year VARCHAR(9) NOT NULL,
    total_items INTEGER NOT NULL,
    total_quantity DECIMAL(15,2) NOT NULL,
    total_value DECIMAL(15,2) NOT NULL,
    valuation_method_used VARCHAR(20), -- Primary method used
    snapshot_date DATE NOT NULL,
    is_finalized BOOLEAN DEFAULT false,
    finalized_at TIMESTAMP,
    finalized_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, financial_year_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_closing_stock_snapshots_business_id ON closing_stock_snapshots(business_id);
CREATE INDEX IF NOT EXISTS idx_closing_stock_snapshots_financial_year_id ON closing_stock_snapshots(financial_year_id);
CREATE INDEX IF NOT EXISTS idx_closing_stock_snapshots_item_id ON closing_stock_snapshots(item_id);
CREATE INDEX IF NOT EXISTS idx_closing_stock_snapshots_snapshot_date ON closing_stock_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_closing_stock_summary_business_id ON closing_stock_summary(business_id);
CREATE INDEX IF NOT EXISTS idx_closing_stock_summary_financial_year_id ON closing_stock_summary(financial_year_id);

-- Comments
COMMENT ON TABLE closing_stock_snapshots IS 'Individual item closing stock snapshots at financial year end';
COMMENT ON TABLE closing_stock_summary IS 'Aggregated closing stock summary for financial year';

