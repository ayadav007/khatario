-- Migration 018: Purchase Returns System
-- Handles returning goods to suppliers with GST reversal

-- Purchase Returns Table
CREATE TABLE IF NOT EXISTS purchase_returns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
    return_number VARCHAR(100) NOT NULL,
    return_date DATE NOT NULL,
    original_purchase_date DATE,  -- Reference to original purchase date
    reason VARCHAR(200),
    place_of_supply_state_code VARCHAR(2),
    subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0,
    discount_total DECIMAL(15, 2) DEFAULT 0,
    tax_total DECIMAL(15, 2) DEFAULT 0,
    cgst_total DECIMAL(12,2) DEFAULT 0,
    sgst_total DECIMAL(12,2) DEFAULT 0,
    igst_total DECIMAL(12,2) DEFAULT 0,
    round_off DECIMAL(10, 2) DEFAULT 0,
    grand_total DECIMAL(15, 2) NOT NULL DEFAULT 0,
    refund_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'refunded', 'adjusted'
    refund_amount DECIMAL(15, 2) DEFAULT 0,
    refund_mode VARCHAR(50), -- 'cash', 'bank', 'adjusted_to_purchase'
    refund_date DATE,
    itc_reversed BOOLEAN DEFAULT false,  -- Track if ITC was reversed
    itc_reversal_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    CONSTRAINT unique_business_return_number UNIQUE(business_id, return_number)
);

-- Purchase Return Items
CREATE TABLE IF NOT EXISTS purchase_return_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    return_id UUID REFERENCES purchase_returns(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    hsn_sac VARCHAR(10),
    qty DECIMAL(10, 2) NOT NULL,
    unit VARCHAR(50),
    unit_price DECIMAL(15, 2) NOT NULL,
    discount_percent DECIMAL(5, 2) DEFAULT 0,
    discount_amount DECIMAL(10, 2) DEFAULT 0,
    taxable_value DECIMAL(15, 2) DEFAULT 0,
    tax_rate DECIMAL(5, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    cgst_amount DECIMAL(12,2) DEFAULT 0,
    sgst_amount DECIMAL(12,2) DEFAULT 0,
    igst_amount DECIMAL(12,2) DEFAULT 0,
    line_total DECIMAL(15, 2) NOT NULL,
    sort_order INTEGER DEFAULT 0
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_purchase_returns_business_id ON purchase_returns(business_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier_id ON purchase_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase_id ON purchase_returns(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_date ON purchase_returns(return_date);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_refund_status ON purchase_returns(refund_status);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return_id ON purchase_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_item_id ON purchase_return_items(item_id);

-- Triggers
DROP TRIGGER IF EXISTS update_purchase_returns_updated_at ON purchase_returns;
CREATE TRIGGER update_purchase_returns_updated_at BEFORE UPDATE ON purchase_returns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE purchase_returns IS 'Tracks goods returned to suppliers with GST reversal';
COMMENT ON COLUMN purchase_returns.itc_reversed IS 'Whether Input Tax Credit was reversed for this return';
COMMENT ON COLUMN purchase_returns.refund_status IS 'Status of refund from supplier';

