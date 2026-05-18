-- WhatsApp Conversation Notes
-- Migration: 034_whatsapp_conversation_notes.sql
-- 
-- Creates table for internal notes on conversations (not sent to WhatsApp)

CREATE TABLE IF NOT EXISTS whatsapp_conversation_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    note_text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversation_notes_conversation_id ON whatsapp_conversation_notes(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_notes_business_id ON whatsapp_conversation_notes(business_id);
CREATE INDEX IF NOT EXISTS idx_conversation_notes_user_id ON whatsapp_conversation_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_notes_created_at ON whatsapp_conversation_notes(created_at DESC);

-- Comments
COMMENT ON TABLE whatsapp_conversation_notes IS 'Internal notes for conversations (not sent to WhatsApp)';
COMMENT ON COLUMN whatsapp_conversation_notes.user_id IS 'Agent/user who created the note';

