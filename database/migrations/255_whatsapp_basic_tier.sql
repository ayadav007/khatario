-- Migration 255: Basic WhatsApp (settings_whatsapp) on all active plans + daily send limits

-- Enable WhatsApp connection/settings for every active plan (Basic tier)
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT p.id, 'settings_whatsapp', true
FROM subscription_plans p
WHERE p.is_active = true
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;

-- Tiered daily message caps for Basic WhatsApp (transactional sends)
INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value) VALUES
  ('free', 'max_whatsapp_per_day', 5),
  ('trial', 'max_whatsapp_per_day', 50),
  ('professional', 'max_whatsapp_per_day', 10),
  ('business', 'max_whatsapp_per_day', 100),
  ('enterprise', 'max_whatsapp_per_day', -1),
  ('connect', 'max_whatsapp_per_day', 20),
  ('hr_starter', 'max_whatsapp_per_day', 10),
  ('hr_pro', 'max_whatsapp_per_day', 50),
  ('hr_trial', 'max_whatsapp_per_day', 50),
  ('hr_free', 'max_whatsapp_per_day', 5)
ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = EXCLUDED.limit_value;

COMMENT ON COLUMN platform_features.id IS
  'settings_whatsapp = Basic connect; integration_whatsapp_* = paid addons';
