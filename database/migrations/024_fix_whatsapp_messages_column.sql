-- Fix whatsapp_messages table to ensure message_text column exists
-- This migration adds the column if it doesn't exist

ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS message_text TEXT;

