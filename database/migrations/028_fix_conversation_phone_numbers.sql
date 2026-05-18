-- Fix conversation phone numbers by updating from_number to match conversation_id
-- For individual conversations, conversation_id should equal the normalized phone number
-- This script updates from_number to match conversation_id for individual chats

-- First, let's see what needs to be fixed (for review)
SELECT 
  id,
  conversation_id,
  from_number,
  is_group,
  CASE 
    WHEN is_group = false AND conversation_id != from_number THEN 'NEEDS_FIX'
    ELSE 'OK'
  END as status
FROM whatsapp_conversations
WHERE is_group = false
ORDER BY created_at DESC;

-- Update from_number to match conversation_id for individual conversations
-- This ensures the phone number displayed in UI is correct
UPDATE whatsapp_conversations
SET from_number = conversation_id,
    updated_at = CURRENT_TIMESTAMP
WHERE is_group = false
  AND conversation_id != from_number
  AND conversation_id ~ '^[0-9]+$'; -- Only update if conversation_id is all digits (phone number)

-- Show results
SELECT 
  COUNT(*) as conversations_fixed
FROM whatsapp_conversations
WHERE is_group = false
  AND conversation_id = from_number;

