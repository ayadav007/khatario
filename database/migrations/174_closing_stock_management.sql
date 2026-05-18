-- Closing stock management: normalized snapshot headers + line items + physical audit
-- Legacy tables closing_stock_snapshots (per-item rows) and closing_stock_summary remain for backward compatibility.

CREATE TABLE IF NOT EXISTS closing_stock_snapshot_headers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    financial_year_id UUID REFERENCES financial_years(id) ON DELETE SET NULL,
    financial_year VARCHAR(9) NOT NULL,
    snapshot_date DATE NOT NULL,
    valuation_method VARCHAR(30) NOT NULL
        CHECK (valuation_method IN ('fifo', 'weighted_avg', 'last_purchase')),
    total_value DECIMAL(18, 2) NOT NULL DEFAULT 0,
    total_items INTEGER NOT NULL DEFAULT 0,
    total_quantity DECIMAL(18, 4) NOT NULL DEFAULT 0,
    is_locked BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cs_snapshot_headers_business_fy
    ON closing_stock_snapshot_headers (business_id, financial_year, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_cs_snapshot_headers_business_date
    ON closing_stock_snapshot_headers (business_id, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS closing_stock_snapshot_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    snapshot_id UUID NOT NULL REFERENCES closing_stock_snapshot_headers(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity DECIMAL(18, 4) NOT NULL,
    valuation_price DECIMAL(18, 6) NOT NULL,
    total_value DECIMAL(18, 2) NOT NULL,
    last_purchase_date DATE,
    UNIQUE (snapshot_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_cs_snapshot_items_snapshot ON closing_stock_snapshot_items (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_cs_snapshot_items_item ON closing_stock_snapshot_items (item_id);

CREATE TABLE IF NOT EXISTS stock_audit_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    snapshot_id UUID NOT NULL REFERENCES closing_stock_snapshot_headers(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    system_qty DECIMAL(18, 4) NOT NULL,
    physical_qty DECIMAL(18, 4) NOT NULL,
    difference DECIMAL(18, 4) GENERATED ALWAYS AS (physical_qty - system_qty) STORED,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (snapshot_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_audit_snapshot ON stock_audit_entries (snapshot_id);

ALTER TABLE closing_stock_summary
    ADD COLUMN IF NOT EXISTS snapshot_header_id UUID REFERENCES closing_stock_snapshot_headers(id) ON DELETE SET NULL;

-- Allow last_purchase in legacy line table (synced from new engine)
ALTER TABLE closing_stock_snapshots
    DROP CONSTRAINT IF EXISTS closing_stock_snapshots_valuation_method_check;
ALTER TABLE closing_stock_snapshots
    ADD CONSTRAINT closing_stock_snapshots_valuation_method_check
    CHECK (valuation_method IN ('fifo', 'lifo', 'weighted_avg', 'simple', 'last_purchase'));

COMMENT ON TABLE closing_stock_snapshot_headers IS 'One row per closing stock snapshot run (financial control)';
COMMENT ON TABLE closing_stock_snapshot_items IS 'Valued lines for a closing stock snapshot';
COMMENT ON TABLE stock_audit_entries IS 'Physical count vs system qty for a snapshot';
