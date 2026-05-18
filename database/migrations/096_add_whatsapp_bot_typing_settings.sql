-- Migration: Add WhatsApp bot typing indicator settings to business_settings table
-- Date: 2024

-- Add whatsapp_bot_typing_enabled column
ALTER TABLE business_settings 
ADD COLUMN IF NOT EXISTS whatsapp_bot_typing_enabled BOOLEAN DEFAULT false;

-- Add whatsapp_bot_typing_delay_seconds column
ALTER TABLE business_settings 
ADD COLUMN IF NOT EXISTS whatsapp_bot_typing_delay_seconds INTEGER DEFAULT 3;

-- Add comments for documentation
COMMENT ON COLUMN business_settings.whatsapp_bot_typing_enabled IS 'Enable typing indicator animation for all WhatsApp bot responses';
COMMENT ON COLUMN business_settings.whatsapp_bot_typing_delay_seconds IS 'Delay in seconds before sending bot response (1-10 seconds)';
