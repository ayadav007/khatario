-- Migration 363: separate seat pools for Billing users and Connect agents.
-- users.seat_type says which plan a login counts against: 'billing' (Billing/HR plan max_users)
-- or 'connect' (Connect plan max_users). Connect agents hold the WhatsApp Agent role (or a role
-- within the same view-only limits) and cannot sign in while Connect is not active.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS seat_type VARCHAR(16) NOT NULL DEFAULT 'billing';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_seat_type_check;
ALTER TABLE users
  ADD CONSTRAINT users_seat_type_check CHECK (seat_type IN ('billing', 'connect'));

CREATE INDEX IF NOT EXISTS idx_users_business_seat_type ON users (business_id, seat_type);

-- Staff of Connect-only businesses (no Billing, no HR) were Connect seats all along.
UPDATE users u
   SET seat_type = 'connect'
 WHERE COALESCE(u.is_primary_admin, false) = false
   AND u.seat_type = 'billing'
   AND business_has_enabled_module(u.business_id, 'connect')
   AND NOT business_has_enabled_module(u.business_id, 'billing')
   AND NOT business_has_enabled_module(u.business_id, 'hr');

-- "whatsapp" now guards Connect setup (campaigns, bot rules, contact groups, media, dashboards,
-- order approval) as well as AI agent settings. Existing roles keep what they could do before;
-- the WhatsApp Agent role created for Connect seats does not get it.
UPDATE permission_modules
   SET module_name = 'WhatsApp setup & campaigns',
       description = 'Campaigns, bot rules, contact groups, AI agent, shop and WhatsApp dashboards'
 WHERE module_key = 'whatsapp';

INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'whatsapp', true, true, true, true, true
FROM user_roles ur
ON CONFLICT (role_id, module_key) DO NOTHING;
