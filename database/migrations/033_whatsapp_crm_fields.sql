-- WhatsApp CRM Fields for Conversations
-- Migration: 033_whatsapp_crm_fields.sql
-- 
-- Adds CRM-specific fields to whatsapp_conversations table:
-- - assigned_to: Agent/user assignment
-- - lead_status: Lead status tracking (new, interested, follow_up, converted, lost)
-- - conversation_status: Conversation workflow status (open, pending, closed)
--   Note: This is separate from the existing 'status' field (active/archived/blocked)

-- Add assigned_to field for agent assignment
ALTER TABLE whatsapp_conversations 
ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;

-- Add lead_status field
ALTER TABLE whatsapp_conversations 
ADD COLUMN IF NOT EXISTS lead_status VARCHAR(20) DEFAULT 'new' 
CHECK (lead_status IN ('new', 'interested', 'follow_up', 'converted', 'lost'));

-- Add conversation_status field (separate from technical status)
ALTER TABLE whatsapp_conversations 
ADD COLUMN IF NOT EXISTS conversation_status VARCHAR(20) DEFAULT 'open'
CHECK (conversation_status IN ('open', 'pending', 'closed'));

-- Set default conversation_status to 'open' for existing active conversations
UPDATE whatsapp_conversations 
SET conversation_status = 'open' 
WHERE conversation_status IS NULL AND status = 'active';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_assigned_to ON whatsapp_conversations(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_lead_status ON whatsapp_conversations(lead_status);
CREATE INDEX IF NOT EXISTS idx_conversations_conversation_status ON whatsapp_conversations(conversation_status);

-- Comments
COMMENT ON COLUMN whatsapp_conversations.assigned_to IS 'User/agent assigned to this conversation';
COMMENT ON COLUMN whatsapp_conversations.lead_status IS 'Lead status: new, interested, follow_up, converted, lost';
COMMENT ON COLUMN whatsapp_conversations.conversation_status IS 'Conversation workflow status: open, pending, closed (separate from technical status)';

