-- Repair / idempotent: full notifications.type CHECK (migration 130 + 178 hub types).
-- Use if 178 failed at chk_notification_type after hub tables were created, or to align
-- an older 178 definition with current code.

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
    'todo_reminder',
    'general'
));
