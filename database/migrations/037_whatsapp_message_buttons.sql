-- WhatsApp Message Buttons Storage
-- Migration: 037_whatsapp_message_buttons.sql
-- 
-- Adds buttons JSONB column to whatsapp_conversation_messages to store button structure
-- for interactive button/list messages

ALTER TABLE whatsapp_conversation_messages 
ADD COLUMN IF NOT EXISTS buttons JSONB;

-- Create index for button queries (GIN index for JSONB)
CREATE INDEX IF NOT EXISTS idx_conversation_messages_buttons ON whatsapp_conversation_messages USING GIN (buttons) WHERE buttons IS NOT NULL;

-- Comments
COMMENT ON COLUMN whatsapp_conversation_messages.buttons IS 'Button structure for interactive messages (JSONB array of {id, title, type, phone, url})';

