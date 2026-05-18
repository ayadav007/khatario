-- =====================================================
-- ADD WAREHOUSE FEATURE TO FEATURE REGISTRY
-- Migration: add_warehouse_feature.sql
-- Date: 2025-01-25
-- Description: Add Multi-Warehouse feature to platform_features table
-- =====================================================

-- Insert Warehouse feature into platform_features
INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon)
VALUES (
  'settings_multi_warehouse',
  'settings',
  'Warehouses',
  'Manage multiple warehouses for inventory storage',
  '/settings/warehouses',
  4,
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

-- Note: The feature will appear in all plans in the feature matrix.
-- Platform admin can enable/disable it per plan as needed.
-- By default, it will be disabled for all plans until admin enables it.
