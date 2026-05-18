-- Migration: 046_ai_provider_dev_prod_mode.sql
-- Purpose: Add Dev/Prod mode and allowed phone numbers for development testing

-- Add mode column (defaults to 'prod' for existing records)
ALTER TABLE ai_provider_config 
ADD COLUMN IF NOT EXISTS mode VARCHAR(10) DEFAULT 'prod' CHECK (mode IN ('dev', 'prod'));

-- Add dev_allowed_phones column (JSONB array of phone numbers)
ALTER TABLE ai_provider_config 
ADD COLUMN IF NOT EXISTS dev_allowed_phones JSONB DEFAULT '[]'::jsonb;

-- Comments for documentation
COMMENT ON COLUMN ai_provider_config.mode IS 'Mode: dev (only respond to allowed phones) or prod (respond to all)';
COMMENT ON COLUMN ai_provider_config.dev_allowed_phones IS 'Array of phone numbers allowed in dev mode (e.g., ["919876543210", "919123456789"])';
