-- WhatsApp Conversation Custom Fields
-- Migration: 036_whatsapp_conversation_custom_fields.sql
-- 
-- Creates table for custom key-value fields on conversations (company, city, plan, budget, etc.)

CREATE TABLE IF NOT EXISTS whatsapp_conversation_custom_fields (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    field_key VARCHAR(100) NOT NULL,
    field_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(conversation_id, field_key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_custom_fields_conversation_id ON whatsapp_conversation_custom_fields(conversation_id);
CREATE INDEX IF NOT EXISTS idx_custom_fields_business_id ON whatsapp_conversation_custom_fields(business_id);
CREATE INDEX IF NOT EXISTS idx_custom_fields_field_key ON whatsapp_conversation_custom_fields(field_key);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_conversation_custom_fields_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_custom_fields_updated_at
    BEFORE UPDATE ON whatsapp_conversation_custom_fields
    FOR EACH ROW
    EXECUTE FUNCTION update_conversation_custom_fields_updated_at();

-- Comments
COMMENT ON TABLE whatsapp_conversation_custom_fields IS 'Custom key-value fields for conversations (company, city, plan, budget, etc.)';
COMMENT ON COLUMN whatsapp_conversation_custom_fields.field_key IS 'Field identifier (company, city, plan, budget, etc.)';
COMMENT ON COLUMN whatsapp_conversation_custom_fields.field_value IS 'Field value (text)';

