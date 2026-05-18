-- Fix phone number fields that are too small
-- Migration: 045_fix_phone_varchar_length.sql
-- 
-- Changes from_number and to_number from VARCHAR(20) to VARCHAR(50)
-- to accommodate full JIDs and international phone numbers

-- Conversations table
ALTER TABLE whatsapp_conversations 
ALTER COLUMN from_number TYPE VARCHAR(50);

ALTER TABLE whatsapp_conversations 
ALTER COLUMN to_number TYPE VARCHAR(50);

-- Messages table
ALTER TABLE whatsapp_conversation_messages 
ALTER COLUMN from_number TYPE VARCHAR(50);

ALTER TABLE whatsapp_conversation_messages 
ALTER COLUMN to_number TYPE VARCHAR(50);

-- Comments
COMMENT ON COLUMN whatsapp_conversations.from_number IS 'Customer phone number or JID (up to 50 chars)';
COMMENT ON COLUMN whatsapp_conversations.to_number IS 'Business phone number or JID (up to 50 chars)';
COMMENT ON COLUMN whatsapp_conversation_messages.from_number IS 'Sender phone number or JID (up to 50 chars)';
COMMENT ON COLUMN whatsapp_conversation_messages.to_number IS 'Recipient phone number or JID (up to 50 chars)';
