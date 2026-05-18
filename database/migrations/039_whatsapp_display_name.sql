-- Add whatsapp_display_name field to store the name WhatsApp provides (pushName)
-- This is the name that WhatsApp shows, which may come from the phone's address book
-- or the contact's WhatsApp profile name
ALTER TABLE whatsapp_conversations 
ADD COLUMN IF NOT EXISTS whatsapp_display_name VARCHAR(255);

COMMENT ON COLUMN whatsapp_conversations.whatsapp_display_name IS 'Display name provided by WhatsApp (pushName) - may be from phone address book or WhatsApp profile';

