-- Supplier Hub is its own plan feature. The supplier list stays on purchase_suppliers.
-- Existing plans keep the same on/off state they already have for Suppliers,
-- so unchecking Supplier Hub later does not turn the supplier list off.

INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon)
VALUES (
  'purchase_supplier_hub',
  'purchase',
  'Supplier Hub',
  'Connect with businesses, incoming bills, and supplier orders',
  '/suppliers/hub',
  3,
  true,
  false
)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  route_path = EXCLUDED.route_path,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  is_addon = false,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT plan_id, 'purchase_supplier_hub', enabled
FROM subscription_plan_features
WHERE feature_id = 'purchase_suppliers'
ON CONFLICT (plan_id, feature_id) DO NOTHING;
