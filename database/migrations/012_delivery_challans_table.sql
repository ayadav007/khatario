-- Migration: Delivery Challans Table
-- Purpose: Create delivery_challans and delivery_challan_items tables for shipping documents

-- Delivery Challans
CREATE TABLE IF NOT EXISTS delivery_challans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
    challan_number VARCHAR(100) NOT NULL,
    challan_date DATE NOT NULL,
    delivery_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft', -- 'draft', 'sent', 'delivered', 'cancelled'
    e_way_bill_number VARCHAR(50), -- For E-Way Bill if applicable
    vehicle_number VARCHAR(50),
    transporter_name VARCHAR(200),
    transporter_gstin VARCHAR(15),
    shipping_address TEXT,
    billing_address TEXT,
    place_of_delivery VARCHAR(100),
    dispatch_from_address TEXT,
    notes TEXT,
    terms TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    CONSTRAINT unique_business_challan_number UNIQUE(business_id, challan_number),
    CONSTRAINT check_challan_reference CHECK (
        invoice_id IS NOT NULL OR sales_order_id IS NOT NULL OR customer_id IS NOT NULL
    )
);

-- Delivery Challan Items
CREATE TABLE IF NOT EXISTS delivery_challan_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delivery_challan_id UUID REFERENCES delivery_challans(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    item_name VARCHAR(255) NOT NULL,
    description TEXT,
    hsn_sac VARCHAR(10),
    qty DECIMAL(10, 2) NOT NULL,
    unit VARCHAR(50),
    delivered_qty DECIMAL(10, 2) DEFAULT 0, -- How much has been delivered
    sort_order INTEGER DEFAULT 0
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_delivery_challans_business_id ON delivery_challans(business_id);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_customer_id ON delivery_challans(customer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_invoice_id ON delivery_challans(invoice_id);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_sales_order_id ON delivery_challans(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_status ON delivery_challans(status);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_date ON delivery_challans(challan_date);
CREATE INDEX IF NOT EXISTS idx_delivery_challan_items_challan_id ON delivery_challan_items(delivery_challan_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_delivery_challans_updated_at ON delivery_challans;
CREATE TRIGGER update_delivery_challans_updated_at BEFORE UPDATE ON delivery_challans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE delivery_challans IS 'Delivery challans for shipping goods without invoicing (non-taxable shipping document)';
COMMENT ON TABLE delivery_challan_items IS 'Items in delivery challans';

