-- Print language is a plan feature. Platform admin turns it on or off per plan
-- from Admin → Plans → Features. Existing plans start enabled so current
-- document languages keep printing until an admin disables the feature.

INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon)
VALUES (
  'settings_document_language',
  'settings',
  'Print language',
  'Choose a language for headings on invoices, challans, receipts, reports, payslips, and letters',
  '/settings/business',
  9,
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
SELECT sp.id, 'settings_document_language', TRUE
FROM subscription_plans sp
ON CONFLICT (plan_id, feature_id) DO NOTHING;
