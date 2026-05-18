-- Migration: Add quantity_request to notification types
-- Purpose: Allow quantity_request notifications for the multi-tier stock request flow

-- Add quantity_request and quantity_response to notification types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notification_type;
ALTER TABLE notifications ADD CONSTRAINT chk_notification_type CHECK (type IN (
    'supplier_request', 
    'supplier_approved', 
    'supplier_rejected',
    'supplier_access_granted',
    'low_stock_alert',
    'quantity_request',
    'quantity_response',
    'payment_reminder',
    'invoice_due',
    'general'
));
