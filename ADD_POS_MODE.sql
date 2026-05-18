-- Quick SQL to add POS Mode feature to database
-- Run this in your PostgreSQL database

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
