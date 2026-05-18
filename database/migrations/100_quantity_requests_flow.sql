-- Migration: Quantity Requests for Multi-Tier Low Stock Flow
-- Purpose: Track quantity requests/responses between businesses and link to orders/invoices across tiers

CREATE TABLE IF NOT EXISTS quantity_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, -- downstream (customer)
    responder_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, -- upstream (supplier)
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    requested_qty DECIMAL(12,2) NOT NULL CHECK (requested_qty >= 0),
    confirmed_qty DECIMAL(12,2) CHECK (confirmed_qty >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','partial','declined','backorder')),
    need_by_date DATE,
    notes TEXT,
    parent_request_id UUID REFERENCES quantity_requests(id) ON DELETE SET NULL,
    low_stock_alert_id UUID REFERENCES low_stock_alerts(id) ON DELETE SET NULL,
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
    sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quantity_requests_requester ON quantity_requests(requester_business_id);
CREATE INDEX IF NOT EXISTS idx_quantity_requests_responder ON quantity_requests(responder_business_id);
CREATE INDEX IF NOT EXISTS idx_quantity_requests_status ON quantity_requests(status);
CREATE INDEX IF NOT EXISTS idx_quantity_requests_parent ON quantity_requests(parent_request_id);
CREATE INDEX IF NOT EXISTS idx_quantity_requests_item ON quantity_requests(item_id);

-- Trigger to maintain updated_at
DROP TRIGGER IF EXISTS trg_quantity_requests_updated_at ON quantity_requests;
CREATE TRIGGER trg_quantity_requests_updated_at
    BEFORE UPDATE ON quantity_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE quantity_requests IS 'Tracks quantity requests/responses between businesses, linking to POs/SOs/Invoices across tiers';
COMMENT ON COLUMN quantity_requests.status IS 'pending|confirmed|partial|declined|backorder';
COMMENT ON COLUMN quantity_requests.parent_request_id IS 'Chains multi-tier requests when supplier is short';

-- Add quantity_request to notification types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notification_type;
ALTER TABLE notifications ADD CONSTRAINT chk_notification_type CHECK (type IN (
    'supplier_request', 
    'supplier_approved', 
    'supplier_rejected',
    'supplier_access_granted',
    'low_stock_alert',
    'quantity_request',
    'payment_reminder',
    'invoice_due',
    'general'
));
