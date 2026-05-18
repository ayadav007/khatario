-- Migration: Add include_pdf column to whatsapp_reminder_settings table
-- Date: 2024

-- Add include_pdf column to whatsapp_reminder_settings
ALTER TABLE whatsapp_reminder_settings
ADD COLUMN IF NOT EXISTS include_pdf BOOLEAN DEFAULT false;

-- Add comment for clarity
COMMENT ON COLUMN whatsapp_reminder_settings.include_pdf IS 'Whether to include PDF attachment when sending reminder';

