-- Migration 361: "WhatsApp Chats" role permission (module_key whatsapp_inbox).
-- Lets owners choose which roles can see and reply to Connect inbox conversations.
-- Every existing role is granted full access so no one loses the inbox on deploy;
-- owners untick it per role. Roles created afterwards start without it.

INSERT INTO permission_modules (module_key, module_name, description, display_order, is_active)
VALUES ('whatsapp_inbox', 'WhatsApp Chats', 'See, reply to and export WhatsApp inbox conversations and contacts', 29, true)
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'whatsapp_inbox', true, true, true, true, true
FROM user_roles ur
ON CONFLICT (role_id, module_key) DO NOTHING;
