-- Migration 144: Allow businesses to configure their own Google Drive OAuth credentials
-- This enables each business to use their own Google Cloud Project for backups

-- Add columns to cloud_storage_connections for per-business OAuth app credentials
ALTER TABLE cloud_storage_connections
ADD COLUMN IF NOT EXISTS client_id_encrypted TEXT,
ADD COLUMN IF NOT EXISTS client_secret_encrypted TEXT,
ADD COLUMN IF NOT EXISTS redirect_uri TEXT;

-- Comments
COMMENT ON COLUMN cloud_storage_connections.client_id_encrypted IS 'Encrypted OAuth client ID - per business Google Cloud Project';
COMMENT ON COLUMN cloud_storage_connections.client_secret_encrypted IS 'Encrypted OAuth client secret - per business';
COMMENT ON COLUMN cloud_storage_connections.redirect_uri IS 'OAuth redirect URI configured in Google Cloud Console';

-- Update existing connections to mark them as using app-level credentials (null means use env vars)
-- New connections will have these fields populated if using business-specific credentials
