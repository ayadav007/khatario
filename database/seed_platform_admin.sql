-- Seed First Platform Super Admin
-- Run this after schema.sql and seed_subscriptions.sql

-- Insert the first platform owner with default credentials
-- Email: admin@khatario.com
-- Password: admin123
-- Note: Password hash generated using bcrypt with 10 rounds

INSERT INTO platform_admins (
  name, 
  email, 
  password_hash, 
  role, 
  permissions,
  is_active
) VALUES (
  'Platform Owner',
  'admin@khatario.com',
  '$2b$10$c4R8rVJGtJOfBf6SddMg4.5XLXQzLQm/xWdnO/dKQAEPaxDNvEJha',  -- This is placeholder, will be generated properly
  'super_admin',
  '{
    "can_manage_admins": true,
    "can_manage_businesses": true,
    "can_manage_subscriptions": true,
    "can_manage_plans": true,
    "can_view_metrics": true,
    "can_view_logs": true,
    "can_impersonate_business": false
  }'::jsonb,
  true
)
ON CONFLICT (email) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  permissions = EXCLUDED.permissions,
  is_active = EXCLUDED.is_active;

-- Log the creation
INSERT INTO platform_admin_logs (
  admin_id,
  action,
  entity_type,
  details
)
SELECT 
  id,
  'account_created',
  'platform_admin',
  '{"source": "seed_script", "role": "super_admin"}'::jsonb
FROM platform_admins
WHERE email = 'admin@khatario.com';

COMMIT;

-- ============================================================
-- IMPORTANT: Default Credentials for First Login
-- ============================================================
-- Email:    admin@khatario.com
-- Password: admin123
-- 
-- ⚠️ CHANGE THIS PASSWORD IMMEDIATELY AFTER FIRST LOGIN!
-- ============================================================

