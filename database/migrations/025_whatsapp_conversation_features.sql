-- WhatsApp Conversation Features
-- Adds support for pinning, muting, blocking, and labels

-- Add columns for conversation features
ALTER TABLE whatsapp_conversations 
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS is_muted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS muted_until TIMESTAMP,
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMP;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_is_pinned ON whatsapp_conversations(is_pinned) WHERE is_pinned = true;
CREATE INDEX IF NOT EXISTS idx_conversations_status ON whatsapp_conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_is_blocked ON whatsapp_conversations(is_blocked) WHERE is_blocked = true;

-- Labels/Tags System (Many-to-Many)
CREATE TABLE IF NOT EXISTS whatsapp_conversation_labels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) DEFAULT '#25D366', -- Hex color code (default WhatsApp green)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, name) -- One label name per business
);

CREATE TABLE IF NOT EXISTS whatsapp_conversation_label_assignments (
    conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES whatsapp_conversation_labels(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, label_id)
);

-- Indexes for labels
CREATE INDEX IF NOT EXISTS idx_labels_business_id ON whatsapp_conversation_labels(business_id);
CREATE INDEX IF NOT EXISTS idx_label_assignments_conversation ON whatsapp_conversation_label_assignments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_label_assignments_label ON whatsapp_conversation_label_assignments(label_id);

-- Function to update updated_at for labels
CREATE OR REPLACE FUNCTION update_whatsapp_conversation_labels_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_whatsapp_conversation_labels_updated_at
    BEFORE UPDATE ON whatsapp_conversation_labels
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_conversation_labels_updated_at();

