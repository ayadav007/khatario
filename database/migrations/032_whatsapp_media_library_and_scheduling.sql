-- WhatsApp Media Library and Campaign Scheduling
-- Migration: 032_whatsapp_media_library_and_scheduling.sql

-- Media Library table: Store uploaded images/media for WhatsApp campaigns
CREATE TABLE IF NOT EXISTS whatsapp_media_library (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- Media file info
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    file_type VARCHAR(50) NOT NULL, -- 'image/jpeg', 'image/png', etc.
    file_size INTEGER NOT NULL, -- in bytes
    media_url TEXT NOT NULL, -- base64 data URL or file path
    
    -- Metadata
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_file_type CHECK (file_type LIKE 'image/%')
);

-- Add scheduled_at field to campaigns table
ALTER TABLE whatsapp_campaigns 
ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP;

-- Indexes for media library
CREATE INDEX IF NOT EXISTS idx_media_library_business_id ON whatsapp_media_library(business_id);
CREATE INDEX IF NOT EXISTS idx_media_library_created_at ON whatsapp_media_library(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled_at ON whatsapp_campaigns(scheduled_at) WHERE scheduled_at IS NOT NULL;

-- Update timestamps trigger for media library
CREATE OR REPLACE FUNCTION update_whatsapp_media_library_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_whatsapp_media_library_updated_at
    BEFORE UPDATE ON whatsapp_media_library
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_media_library_updated_at();

-- Comments
COMMENT ON TABLE whatsapp_media_library IS 'Media library for WhatsApp campaign images';
COMMENT ON COLUMN whatsapp_campaigns.scheduled_at IS 'Scheduled start time for campaign (NULL = start immediately)';

