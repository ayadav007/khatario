-- Migration: Supplier Low Stock Access Feature
-- Purpose: Add allow_low_stock_access field, enable fuzzy matching, auto-approve linked suppliers

-- ============================================
-- 1. Add allow_low_stock_access column
-- ============================================

ALTER TABLE suppliers 
ADD COLUMN IF NOT EXISTS allow_low_stock_access BOOLEAN DEFAULT false;

-- Update existing suppliers: if linked and approved, set to true
UPDATE suppliers 
SET allow_low_stock_access = true 
WHERE linked_business_id IS NOT NULL 
  AND approval_status = 'approved';

COMMENT ON COLUMN suppliers.allow_low_stock_access IS 
  'Customer grants supplier permission to view their low stock alerts';

-- ============================================
-- 2. Enable PostgreSQL trigram extension for fuzzy matching
-- ============================================

-- Enable pg_trgm extension for fuzzy name matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add trigram index for faster similarity searches
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm 
ON suppliers USING gin(name gin_trgm_ops);

-- Add normalized phone index
CREATE INDEX IF NOT EXISTS idx_suppliers_phone_normalized 
ON suppliers(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) 
WHERE phone IS NOT NULL;

-- ============================================
-- 3. Remove approval requirement (auto-approve when linked)
-- ============================================

-- Auto-approve existing pending requests
UPDATE suppliers 
SET approval_status = 'approved', 
    approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP)
WHERE linked_business_id IS NOT NULL 
  AND approval_status = 'pending';

-- ============================================
-- 4. Update notification types constraint
-- ============================================

-- Add supplier_access_granted to notification types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notification_type;
ALTER TABLE notifications ADD CONSTRAINT chk_notification_type CHECK (type IN (
    'supplier_request', 
    'supplier_approved', 
    'supplier_rejected',
    'supplier_access_granted',
    'low_stock_alert',
    'payment_reminder',
    'invoice_due',
    'general'
));

-- ============================================
-- Migration Complete
-- ============================================
