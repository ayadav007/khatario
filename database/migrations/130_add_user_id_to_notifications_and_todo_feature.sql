-- Migration: Add user_id to notifications and todo feature to registry
-- Purpose: Enable user-specific notifications for todo reminders and add todo to feature registry

-- 1. Add user_id column to notifications table (nullable for backward compatibility)
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- 2. Create index for user-specific notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_business_user ON notifications(business_id, user_id, is_read, created_at DESC);

-- 3. Add todo_reminder to notification types
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
    'invoice_nearing_due',
    'invoice_overdue',
    'todo_reminder',
    'general'
));

-- 4. Add todo feature to platform_features registry (in 'tools' category)
INSERT INTO platform_features (id, category, label, description, route_path, icon_name, sort_order, is_active, is_addon)
VALUES (
    'tools_todo',
    'tools',
    'Todo List',
    'Task management with reminders and assignments',
    '/tools/todo',
    'ClipboardList',
    1,
    true,
    false
)
ON CONFLICT (id) DO UPDATE SET
    category = EXCLUDED.category,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route_path = EXCLUDED.route_path,
    icon_name = EXCLUDED.icon_name,
    sort_order = EXCLUDED.sort_order,
    updated_at = CURRENT_TIMESTAMP;

-- 5. Map todo feature to existing plans (enable for professional and enterprise)
-- This will enable todo for plans that have it in their JSONB features
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT 
    sp.id as plan_id,
    'tools_todo' as feature_id,
    COALESCE((sp.features->'features'->>'todo')::boolean, false) as enabled
FROM subscription_plans sp
WHERE sp.id IN ('professional', 'enterprise', 'enterprise_plus')
ON CONFLICT (plan_id, feature_id) DO UPDATE SET
    enabled = EXCLUDED.enabled;

-- For free plan, explicitly disable if not already set
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
VALUES ('free', 'tools_todo', false)
ON CONFLICT (plan_id, feature_id) DO NOTHING;

COMMENT ON COLUMN notifications.user_id IS 'User who should receive this notification. NULL means notification is for all users in the business.';
