-- Migration 186: Add profile_picture_url to whatsapp_conversations
-- Caches WhatsApp profile picture URLs so they are available in both
-- DB mode and live mode without a live API call on every page load.

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS profile_picture_url TEXT,
  ADD COLUMN IF NOT EXISTS profile_picture_updated_at TIMESTAMPTZ;
