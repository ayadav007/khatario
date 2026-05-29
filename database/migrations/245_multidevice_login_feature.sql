-- Migration 245: Multi-Device Login as a per-plan feature
--
-- Moves the multi-device login policy from the per-user users.allow_multidevice_sync
-- flag to the Feature Registry so platform admins can decide, per subscription plan,
-- whether concurrent logins on multiple devices are allowed.
--
-- When the feature is DISABLED for a business's plan (the default, incl. Free), login
-- bumps users.auth_session_version (single-device: a new login invalidates older tokens).
-- When ENABLED, the version is not bumped, so multiple device sessions stay valid.
--
-- Default: registered but NOT enabled for any plan. Admins opt plans in via
-- Admin → Plans → Features.

INSERT INTO platform_features (id, category, label, description, route_path, icon_name, sort_order, is_active, is_addon)
VALUES (
  'settings_multidevice_login',
  'settings',
  'Multi-Device Login',
  'Allow signing in on multiple devices at the same time without logging the others out. When off, a new login signs out other devices (single-device).',
  NULL,
  'Smartphone',
  60,
  true,
  false
)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  icon_name = EXCLUDED.icon_name,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = CURRENT_TIMESTAMP;

COMMENT ON COLUMN platform_features.id IS 'Unique feature identifier - settings_multidevice_login gates concurrent multi-device sessions';
