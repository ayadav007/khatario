
-- Drop existing WhatsApp tables to start fresh
DROP TABLE IF EXISTS whatsapp_reminder_settings CASCADE;
DROP TABLE IF EXISTS whatsapp_keywords CASCADE;
DROP TABLE IF EXISTS whatsapp_messages CASCADE;
DROP TABLE IF EXISTS whatsapp_sessions CASCADE;
DROP TABLE IF EXISTS whatsapp_config CASCADE;

-- 1. WhatsApp Config: General settings for the business
CREATE TABLE whatsapp_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    is_enabled BOOLEAN DEFAULT false,
    -- We only support 'web' (QR) for now, but keeping this for future
    connection_type VARCHAR(20) DEFAULT 'web_session' CHECK (connection_type IN ('cloud_api', 'web_session')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id)
);

-- 2. WhatsApp Sessions: Technical connection state for Baileys
CREATE TABLE whatsapp_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    -- Status: disconnected, pending_qr, connected
    status VARCHAR(20) DEFAULT 'disconnected',
    -- The JSON blob for Baileys auth state (keys, creds)
    auth_state JSONB,
    -- The actual QR code string (if status is pending_qr)
    last_qr TEXT,
    -- The connected phone number
    phone_number VARCHAR(20),
    -- Last error message if any
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id)
);

-- 3. WhatsApp Messages: Log of sent messages
CREATE TABLE whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    to_number VARCHAR(20) NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text', -- text, template, document, image
    direction VARCHAR(10) DEFAULT 'outbound', -- inbound, outbound
    
    -- Links to other entities
    reference_type VARCHAR(50), -- invoice, payment, reminder
    reference_id UUID,
    
    content TEXT,
    media_url TEXT,
    
    status VARCHAR(20) DEFAULT 'sent', -- sent, delivered, read, failed
    error_message TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. WhatsApp Keywords: Auto-replies
CREATE TABLE whatsapp_keywords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    keyword VARCHAR(100) NOT NULL,
    reply_text TEXT NOT NULL,
    is_exact BOOLEAN DEFAULT true, -- true = exact match, false = contains
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_whatsapp_messages_business ON whatsapp_messages(business_id);
CREATE INDEX idx_whatsapp_messages_to ON whatsapp_messages(to_number);
CREATE INDEX idx_whatsapp_keywords_business ON whatsapp_keywords(business_id);

-- Triggers for updated_at
CREATE TRIGGER update_whatsapp_config_updated_at
    BEFORE UPDATE ON whatsapp_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_whatsapp_sessions_updated_at
    BEFORE UPDATE ON whatsapp_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_whatsapp_keywords_updated_at
    BEFORE UPDATE ON whatsapp_keywords
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

