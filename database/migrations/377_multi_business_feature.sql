-- Additional companies are a plan feature. Free does not include it.
-- Growth, Business, and the signup Trial do. Admin → Plans can change this later.

INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon)
VALUES (
  'settings_multi_business',
  'settings',
  'Additional businesses',
  'Create another company under the same login',
  NULL,
  8,
  true,
  false
)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  is_addon = false,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT p.plan_id, 'settings_multi_business', true
FROM (VALUES ('growth'), ('business'), ('trial')) AS p(plan_id)
WHERE EXISTS (SELECT 1 FROM subscription_plans sp WHERE sp.id = p.plan_id)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;
