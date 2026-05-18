-- =====================================================
-- ADD POS MODE FEATURE TO FEATURE REGISTRY
-- Migration: add_pos_mode_feature.sql
-- Date: 2025-01-25
-- Description: Add POS Mode feature to platform_features table
-- =====================================================

-- Insert POS Mode feature into platform_features
INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon)
VALUES (
  'settings_pos_mode',
  'settings',
  'POS Mode',
  'Retail billing interface with two-column layout and quick payment entry',
  '/invoices/new',
  6,
  true,
  false
)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  route_path = EXCLUDED.route_path,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  is_addon = EXCLUDED.is_addon,
  updated_at = CURRENT_TIMESTAMP;

-- Note: To enable POS Mode for specific plans, use the admin feature matrix UI
-- or run:
-- INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
-- VALUES ('professional', 'settings_pos_mode', true)
-- ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;
