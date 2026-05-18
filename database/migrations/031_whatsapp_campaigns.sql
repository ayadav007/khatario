-- WhatsApp Bulk Messaging Campaigns
-- Migration: 031_whatsapp_campaigns.sql
-- 
-- This migration creates tables for bulk messaging campaigns with:
-- - Campaign management (draft, running, paused, completed, failed)
-- - Recipient tracking with per-recipient status
-- - Anti-ban controls (delays, batch sizes, limits)
-- - Button analytics for interactive messages

-- Campaigns table: Main campaign data
CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    message_type VARCHAR(20) NOT NULL DEFAULT 'text', -- 'text', 'image', 'button'
    message_text TEXT NOT NULL,
    media_url TEXT, -- URL or path for image
    media_type VARCHAR(50), -- 'image/jpeg', 'image/png', etc.
    buttons JSONB, -- Array of {id, title} for button messages
    footer TEXT, -- Optional footer text
    
    -- Campaign status and progress
    status VARCHAR(20) NOT NULL DEFAULT 'draft', -- 'draft', 'running', 'paused', 'completed', 'failed'
    total_recipients INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    pending_count INTEGER NOT NULL DEFAULT 0,
    
    -- Anti-ban settings
    delay_between_messages INTEGER NOT NULL DEFAULT 2, -- seconds
    random_delay_jitter INTEGER NOT NULL DEFAULT 2, -- ±seconds
    batch_size INTEGER NOT NULL DEFAULT 20, -- messages per batch
    pause_between_batches INTEGER NOT NULL DEFAULT 120, -- seconds (2 minutes)
    daily_send_limit INTEGER, -- optional limit
    
    -- Timing
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    paused_at TIMESTAMP,
    last_sent_at TIMESTAMP, -- Last message sent timestamp
    
    -- Metadata
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_status CHECK (status IN ('draft', 'running', 'paused', 'completed', 'failed')),
    CONSTRAINT valid_message_type CHECK (message_type IN ('text', 'image', 'button')),
    CONSTRAINT positive_delays CHECK (delay_between_messages >= 1 AND random_delay_jitter >= 0),
    CONSTRAINT positive_batch_size CHECK (batch_size > 0),
    CONSTRAINT positive_pause CHECK (pause_between_batches >= 0)
);

-- Campaign recipients: Individual recipient tracking
CREATE TABLE IF NOT EXISTS whatsapp_campaign_recipients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES whatsapp_campaigns(id) ON DELETE CASCADE,
    phone VARCHAR(20) NOT NULL, -- Normalized E.164 format
    name VARCHAR(255), -- Optional name from CSV
    
    -- Status tracking
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'read', 'failed'
    error_message TEXT, -- Error details if failed
    
    -- Message tracking
    message_id VARCHAR(255), -- Baileys message ID
    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    read_at TIMESTAMP,
    
    -- Button analytics (if button message)
    button_clicked_id VARCHAR(100), -- Which button was clicked
    button_clicked_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_recipient_status CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed'))
);

-- Campaign settings: Additional configuration (JSONB for flexibility)
CREATE TABLE IF NOT EXISTS whatsapp_campaign_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL UNIQUE REFERENCES whatsapp_campaigns(id) ON DELETE CASCADE,
    
    -- Additional settings stored as JSONB
    settings JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_campaigns_business_id ON whatsapp_campaigns(business_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON whatsapp_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON whatsapp_campaigns(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_id ON whatsapp_campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status ON whatsapp_campaign_recipients(status);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_phone ON whatsapp_campaign_recipients(phone);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_button_clicked ON whatsapp_campaign_recipients(button_clicked_id) WHERE button_clicked_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_settings_campaign_id ON whatsapp_campaign_settings(campaign_id);

-- Update timestamps trigger
CREATE OR REPLACE FUNCTION update_whatsapp_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_whatsapp_campaigns_updated_at
    BEFORE UPDATE ON whatsapp_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_campaigns_updated_at();

CREATE TRIGGER trigger_update_whatsapp_campaign_recipients_updated_at
    BEFORE UPDATE ON whatsapp_campaign_recipients
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_campaigns_updated_at();

CREATE TRIGGER trigger_update_whatsapp_campaign_settings_updated_at
    BEFORE UPDATE ON whatsapp_campaign_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_campaigns_updated_at();

-- Add comments
COMMENT ON TABLE whatsapp_campaigns IS 'Bulk messaging campaigns with anti-ban controls';
COMMENT ON TABLE whatsapp_campaign_recipients IS 'Individual recipient tracking for campaigns';
COMMENT ON TABLE whatsapp_campaign_settings IS 'Additional campaign configuration';

