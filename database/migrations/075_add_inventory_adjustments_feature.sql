-- =====================================================
-- ADD INVENTORY ADJUSTMENTS FEATURE TO REGISTRY
-- Migration: 075_add_inventory_adjustments_feature.sql
-- Date: 2024
-- Description: Add Inventory Adjustments as a controllable feature
-- =====================================================

-- Step 1: Add inventory_adjustments to platform_features
INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon) 
VALUES (
  'purchase_inventory_adjustments',
  'purchase',
  'Inventory Adjustments',
  'Adjust stock quantities and manage inventory corrections',
  '/inventory-adjustments',
  5,
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
  updated_at = CURRENT_TIMESTAMP;

-- Step 2: Map inventory_adjustments to subscription plans
-- Enable for Professional, Business, and Enterprise plans
-- Disable for Free/Starter plan (can be enabled later via admin UI)
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
VALUES
  ('free', 'purchase_inventory_adjustments', false),
  ('professional', 'purchase_inventory_adjustments', true),
  ('business', 'purchase_inventory_adjustments', true),
  ('enterprise', 'purchase_inventory_adjustments', true)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET
  enabled = EXCLUDED.enabled;

-- =====================================================
-- VERIFICATION
-- =====================================================

-- Verify feature was added
-- SELECT * FROM platform_features WHERE id = 'purchase_inventory_adjustments';

-- Verify plan mappings
-- SELECT sp.id, sp.display_name, spf.feature_id, spf.enabled
-- FROM subscription_plans sp
-- LEFT JOIN subscription_plan_features spf ON sp.id = spf.plan_id AND spf.feature_id = 'purchase_inventory_adjustments'
-- ORDER BY sp.sort_order;
