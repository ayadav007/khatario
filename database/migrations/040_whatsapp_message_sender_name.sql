-- Add sender_name column to whatsapp_conversation_messages table
-- This stores the pushName for group messages (sender's name in that group context)
-- For individual messages, this will be NULL
ALTER TABLE whatsapp_conversation_messages 
ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255);

COMMENT ON COLUMN whatsapp_conversation_messages.sender_name IS 'Sender name (pushName) for group messages - the name WhatsApp shows for the sender in that group context';

