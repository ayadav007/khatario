-- Migration 143: Add Backup & Restore Feature to Platform Registry
-- This enables backup/restore functionality for all plans

-- 1. Add backup_restore feature to platform_features
INSERT INTO platform_features (id, category, label, description, route_path, icon_name, sort_order, is_active, is_addon)
VALUES (
  'settings_backup', 
  'settings', 
  'Backup & Restore', 
  'Backup business data and restore from previous backups',
  '/settings/backup',
  'Database',
  50,
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
  is_active = EXCLUDED.is_active,
  updated_at = CURRENT_TIMESTAMP;

-- 2. Enable backup_restore for FREE plan (basic backup functionality)
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
VALUES ('free', 'settings_backup', true)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;

-- 3. Enable for PROFESSIONAL plan (if exists)
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT 'professional', 'settings_backup', true
WHERE EXISTS (SELECT 1 FROM subscription_plans WHERE id = 'professional')
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;

-- 4. Enable for BUSINESS plan (if exists)
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT 'business', 'settings_backup', true
WHERE EXISTS (SELECT 1 FROM subscription_plans WHERE id = 'business')
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;

-- 5. Enable for ENTERPRISE plan (if exists)
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT 'enterprise', 'settings_backup', true
WHERE EXISTS (SELECT 1 FROM subscription_plans WHERE id = 'enterprise')
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;

-- Comments
COMMENT ON COLUMN platform_features.id IS 'Unique feature identifier - settings_backup for backup/restore';
