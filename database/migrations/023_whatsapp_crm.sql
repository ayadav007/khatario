-- WhatsApp CRM Tables
-- For managing two-way conversations, bot states, and customer interactions

-- Conversations: Store individual message threads
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    from_number VARCHAR(20) NOT NULL, -- Customer's phone number
    to_number VARCHAR(20) NOT NULL, -- Business WhatsApp number
    conversation_id VARCHAR(255) NOT NULL, -- Unique conversation identifier (phone number)
    last_message_text TEXT,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_message_direction VARCHAR(10) NOT NULL DEFAULT 'incoming', -- 'incoming' or 'outgoing'
    unread_count INTEGER DEFAULT 0,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL, -- Link to customer if exists
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'archived', 'blocked'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, conversation_id)
);

-- Messages: Store individual messages in conversations
CREATE TABLE IF NOT EXISTS whatsapp_conversation_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    message_id VARCHAR(255) UNIQUE, -- WhatsApp message ID (for deduplication)
    from_number VARCHAR(20) NOT NULL,
    to_number VARCHAR(20) NOT NULL,
    message_text TEXT,
    message_type VARCHAR(20) DEFAULT 'text', -- 'text', 'image', 'document', 'audio', 'video'
    media_url TEXT, -- URL or path to media file
    direction VARCHAR(10) NOT NULL, -- 'incoming' or 'outgoing'
    status VARCHAR(20) DEFAULT 'sent', -- 'sent', 'delivered', 'read', 'failed'
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Conversation States: Track bot conversation state machines
CREATE TABLE IF NOT EXISTS whatsapp_conversation_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    conversation_id VARCHAR(255) NOT NULL, -- Phone number or conversation identifier
    state VARCHAR(50) NOT NULL, -- 'idle', 'waiting_items', 'waiting_quantity', 'waiting_confirm', etc.
    context JSONB DEFAULT '{}', -- Store conversation context (items, quantities, invoice_id, etc.)
    last_interaction_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, conversation_id)
);

-- Support Tickets: Track customer support requests from WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_support_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    message_id UUID REFERENCES whatsapp_conversation_messages(id) ON DELETE SET NULL,
    subject VARCHAR(255),
    description TEXT,
    category VARCHAR(50), -- 'invoice', 'delivery', 'payment', 'other'
    status VARCHAR(20) DEFAULT 'open', -- 'open', 'in_progress', 'resolved', 'closed'
    priority VARCHAR(10) DEFAULT 'medium', -- 'low', 'medium', 'high', 'urgent'
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution_notes TEXT,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Broadcast Campaigns: Track WhatsApp broadcast messages
CREATE TABLE IF NOT EXISTS whatsapp_broadcasts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    message_template TEXT NOT NULL,
    segment_criteria JSONB DEFAULT '{}', -- Filter criteria (city, purchase_history, etc.)
    scheduled_at TIMESTAMP,
    sent_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft', -- 'draft', 'scheduled', 'sending', 'completed', 'failed'
    total_recipients INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Broadcast Recipients: Track individual broadcast sends
CREATE TABLE IF NOT EXISTS whatsapp_broadcast_recipients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    broadcast_id UUID NOT NULL REFERENCES whatsapp_broadcasts(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    phone_number VARCHAR(20) NOT NULL,
    message_id UUID REFERENCES whatsapp_conversation_messages(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'read', 'failed'
    error_message TEXT,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_business_id ON whatsapp_conversations(business_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON whatsapp_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_customer_id ON whatsapp_conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON whatsapp_conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_created_at ON whatsapp_conversation_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_business_id ON whatsapp_conversation_messages(business_id);
CREATE INDEX IF NOT EXISTS idx_conversation_states_business_id ON whatsapp_conversation_states(business_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_business_id ON whatsapp_support_tickets(business_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON whatsapp_support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_broadcasts_business_id ON whatsapp_broadcasts(business_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON whatsapp_broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_id ON whatsapp_broadcast_recipients(broadcast_id);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_whatsapp_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_whatsapp_conversations_updated_at ON whatsapp_conversations;
CREATE TRIGGER update_whatsapp_conversations_updated_at
    BEFORE UPDATE ON whatsapp_conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_conversations_updated_at();

DROP TRIGGER IF EXISTS update_whatsapp_conversation_states_updated_at ON whatsapp_conversation_states;
CREATE TRIGGER update_whatsapp_conversation_states_updated_at
    BEFORE UPDATE ON whatsapp_conversation_states
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_conversations_updated_at();

DROP TRIGGER IF EXISTS update_whatsapp_support_tickets_updated_at ON whatsapp_support_tickets;
CREATE TRIGGER update_whatsapp_support_tickets_updated_at
    BEFORE UPDATE ON whatsapp_support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_conversations_updated_at();

DROP TRIGGER IF EXISTS update_whatsapp_broadcasts_updated_at ON whatsapp_broadcasts;
CREATE TRIGGER update_whatsapp_broadcasts_updated_at
    BEFORE UPDATE ON whatsapp_broadcasts
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_conversations_updated_at();

