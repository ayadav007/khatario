-- Quick cleanup script for WhatsApp data
-- Run this in psql: psql -U postgres -d khatario -f scripts/cleanup_whatsapp_data.sql

-- View current invalid phone numbers (run this first to see what will be deleted)
SELECT 
  'whatsapp_conversation_messages' as table_name,
  COUNT(*) as invalid_count
FROM whatsapp_conversation_messages 
WHERE LENGTH(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g')) < 10 
   OR LENGTH(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g')) > 15
   OR from_number IS NULL
   OR from_number = '';

-- Delete invalid messages
DELETE FROM whatsapp_conversation_messages 
WHERE LENGTH(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g')) < 10 
   OR LENGTH(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g')) > 15
   OR from_number IS NULL
   OR from_number = '';

-- Show remaining count
SELECT COUNT(*) as remaining_messages FROM whatsapp_conversation_messages;

