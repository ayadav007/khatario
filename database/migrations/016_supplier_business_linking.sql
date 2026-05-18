-- Migration: Supplier-Business Linking, Notifications, and Thresholds
-- Purpose: Enable bidirectional supplier relationships, approval workflow, 
--          low stock notifications, and supplier dashboard analytics

-- ============================================
-- 1. Enhance suppliers table for business linking
-- ============================================

-- Add columns for linking suppliers to business accounts
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS linked_business_id UUID REFERENCES businesses(id) ON DELETE SET NULL;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS requested_by_business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Add constraint for approval_status
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS chk_supplier_approval_status;
ALTER TABLE suppliers ADD CONSTRAINT chk_supplier_approval_status 
CHECK (approval_status IN ('pending', 'approved', 'rejected', 'none'));

-- For existing suppliers without linked business, set status to 'none' (regular contact)
UPDATE suppliers SET approval_status = 'none' WHERE linked_business_id IS NULL AND approval_status = 'pending';

COMMENT ON COLUMN suppliers.linked_business_id IS 'References the business account if this supplier is also a user of the app';
COMMENT ON COLUMN suppliers.approval_status IS 'Status of supplier relationship: pending, approved, rejected, or none (regular contact)';
COMMENT ON COLUMN suppliers.requested_by_business_id IS 'Business that initiated the supplier relationship request';

-- ============================================
-- 2. Create notifications table
-- ============================================

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    reference_type VARCHAR(50),
    reference_id UUID,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP,
    CONSTRAINT chk_notification_type CHECK (type IN (
        'supplier_request', 
        'supplier_approved', 
        'supplier_rejected',
        'low_stock_alert',
        'payment_reminder',
        'invoice_due',
        'general'
    ))
);

CREATE INDEX IF NOT EXISTS idx_notifications_business_unread 
ON notifications(business_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_reference 
ON notifications(reference_type, reference_id);

COMMENT ON TABLE notifications IS 'In-app notifications for users';
COMMENT ON COLUMN notifications.type IS 'Type of notification: supplier_request, low_stock_alert, etc.';

-- ============================================
-- 3. Create supplier_item_thresholds table
-- ============================================

CREATE TABLE IF NOT EXISTS supplier_item_thresholds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    low_stock_threshold DECIMAL(10,2) NOT NULL CHECK (low_stock_threshold >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_supplier_customer_item UNIQUE (supplier_business_id, customer_business_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_thresholds_supplier 
ON supplier_item_thresholds(supplier_business_id);

CREATE INDEX IF NOT EXISTS idx_thresholds_customer 
ON supplier_item_thresholds(customer_business_id);

CREATE INDEX IF NOT EXISTS idx_thresholds_item 
ON supplier_item_thresholds(item_id);

COMMENT ON TABLE supplier_item_thresholds IS 'Low stock thresholds set by suppliers for their customers items';
COMMENT ON COLUMN supplier_item_thresholds.supplier_business_id IS 'Supplier business monitoring the stock';
COMMENT ON COLUMN supplier_item_thresholds.customer_business_id IS 'Customer business whose stock is being monitored';
COMMENT ON COLUMN supplier_item_thresholds.low_stock_threshold IS 'Alert threshold set by supplier';

-- ============================================
-- 4. Create low_stock_alerts table
-- ============================================

CREATE TABLE IF NOT EXISTS low_stock_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    threshold_id UUID REFERENCES supplier_item_thresholds(id) ON DELETE CASCADE,
    current_stock DECIMAL(10,2) NOT NULL,
    threshold DECIMAL(10,2) NOT NULL,
    alert_status VARCHAR(20) DEFAULT 'active',
    first_alerted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    dismissed_at TIMESTAMP,
    CONSTRAINT chk_alert_status CHECK (alert_status IN ('active', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_supplier_active 
ON low_stock_alerts(supplier_business_id, alert_status, first_alerted_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_customer 
ON low_stock_alerts(customer_business_id, alert_status);

COMMENT ON TABLE low_stock_alerts IS 'Tracks low stock events for supplier monitoring';
COMMENT ON COLUMN low_stock_alerts.alert_status IS 'active: needs attention, resolved: stock replenished, dismissed: manually dismissed';

-- ============================================
-- 5. Optional: Add supplier_id to items table
-- ============================================

ALTER TABLE items ADD COLUMN IF NOT EXISTS default_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

COMMENT ON COLUMN items.default_supplier_id IS 'Default supplier for this item (optional)';

-- ============================================
-- 6. Create indexes for performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_suppliers_linked_business 
ON suppliers(linked_business_id, approval_status) WHERE linked_business_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_requested_by 
ON suppliers(requested_by_business_id, approval_status) WHERE requested_by_business_id IS NOT NULL;

-- ============================================
-- 7. Add trigger to update updated_at timestamp
-- ============================================

CREATE OR REPLACE FUNCTION update_threshold_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_threshold_timestamp ON supplier_item_thresholds;
CREATE TRIGGER trg_update_threshold_timestamp
    BEFORE UPDATE ON supplier_item_thresholds
    FOR EACH ROW
    EXECUTE FUNCTION update_threshold_timestamp();

-- ============================================
-- Migration Complete
-- ============================================

-- Summary:
-- ✓ Enhanced suppliers table with business linking and approval workflow
-- ✓ Created notifications table for in-app alerts
-- ✓ Created supplier_item_thresholds for low stock monitoring
-- ✓ Created low_stock_alerts to track stock events
-- ✓ Added optional default_supplier_id to items
-- ✓ Created performance indexes
-- ✓ Added timestamp trigger for thresholds

