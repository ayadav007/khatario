-- Scan & Add Items is its own plan feature: adding new products to the shop by barcode or label photo.
-- It is separate from advanced_barcode, which is scanning existing items at the billing counter.
-- On for every plan, Free included; the plan matrix can switch it off per plan later.

INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon)
VALUES (
  'items_scan_onboarding',
  'advanced',
  'Scan & Add Items',
  'Add new products by scanning barcodes, with opening stock',
  '/items/scan-add',
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
  is_active = true,
  is_addon = false,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT id, 'items_scan_onboarding', true
FROM subscription_plans
ON CONFLICT (plan_id, feature_id) DO NOTHING;
