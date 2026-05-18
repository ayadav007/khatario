-- Fix WhatsApp Phone Numbers
-- This script helps clean up incorrectly extracted phone numbers
-- Run this after fixing the phone number extraction logic

-- IMPORTANT: Choose ONE of the options below based on your needs
-- Comment out the options you don't want to run

-- ============================================
-- Option 1: Delete messages with invalid phone numbers only
-- This removes messages with phone numbers that are too long, too short, or empty
-- Keeps valid messages intact
-- ============================================
DELETE FROM whatsapp_conversation_messages 
WHERE LENGTH(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g')) < 10 
   OR LENGTH(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g')) > 15
   OR from_number IS NULL
   OR from_number = '';

-- ============================================
-- Option 2: Delete ALL WhatsApp conversation messages
-- This removes all messages but keeps the conversations
-- Uncomment the line below to use this option
-- ============================================
-- DELETE FROM whatsapp_conversation_messages;

-- ============================================
-- Option 3: Delete ALL WhatsApp conversations and messages
-- Most aggressive cleanup - removes everything and starts fresh
-- Uncomment the lines below to use this option
-- ============================================
-- DELETE FROM whatsapp_conversation_messages;
-- DELETE FROM whatsapp_conversation_states;
-- DELETE FROM whatsapp_conversation_label_assignments;
-- DELETE FROM whatsapp_conversations;

-- ============================================
-- Option 4: Delete messages for a specific business only
-- Replace 'YOUR_BUSINESS_ID_HERE' with your actual business UUID
-- ============================================
-- DELETE FROM whatsapp_conversation_messages 
-- WHERE business_id = 'YOUR_BUSINESS_ID_HERE';

-- ============================================
-- Option 5: View invalid phone numbers before deleting (for review)
-- Run this first to see what will be deleted
-- ============================================
-- SELECT 
--   id,
--   from_number,
--   LENGTH(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g')) as phone_length,
--   message_text,
--   created_at
-- FROM whatsapp_conversation_messages 
-- WHERE LENGTH(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g')) < 10 
--    OR LENGTH(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g')) > 15
--    OR from_number IS NULL
--    OR from_number = ''
-- ORDER BY created_at DESC;

-- Note: After running this, new messages will have correctly extracted phone numbers
-- based on the fixed extraction logic in lib/whatsapp.ts

