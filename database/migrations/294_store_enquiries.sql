-- Storefront contact-form enquiries: shoppers message the merchant from /contact.

CREATE TABLE IF NOT EXISTS store_enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(255),
  message TEXT NOT NULL,
  source_path VARCHAR(200),
  status VARCHAR(12) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'read', 'replied', 'archived')),
  ip_hash VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_store_enquiries_business
  ON store_enquiries (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_enquiries_status
  ON store_enquiries (business_id, status);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notification_type;
ALTER TABLE notifications ADD CONSTRAINT chk_notification_type CHECK (type IN (
    'supplier_request',
    'supplier_approved',
    'supplier_rejected',
    'supplier_access_granted',
    'low_stock_alert',
    'quantity_request',
    'quantity_response',
    'hub_connection_request',
    'hub_connection_accepted',
    'hub_connection_declined',
    'payment_reminder',
    'invoice_due',
    'invoice_nearing_due',
    'invoice_overdue',
    'invoice_viewed',
    'todo_reminder',
    'store_enquiry',
    'general'
)) NOT VALID;

DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE store_enquiries TO PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'khatario_user') THEN
    GRANT ALL PRIVILEGES ON TABLE store_enquiries TO khatario_user;
  END IF;
END $$;

COMMENT ON TABLE store_enquiries IS 'Messages sent from the online store contact form';
