-- WhatsApp Automation Events Timeline
-- Migration: 035_whatsapp_automation_events.sql
-- 
-- Creates table for tracking automation events in conversations (bot messages, button clicks, flows, campaigns)

CREATE TABLE IF NOT EXISTS whatsapp_automation_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_event_type CHECK (event_type IN (
        'bot_message', 
        'button_clicked', 
        'flow_entered', 
        'flow_exited', 
        'cta_clicked', 
        'campaign_triggered'
    ))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_automation_events_conversation_id ON whatsapp_automation_events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_automation_events_business_id ON whatsapp_automation_events(business_id);
CREATE INDEX IF NOT EXISTS idx_automation_events_event_type ON whatsapp_automation_events(event_type);
-- Composite index for timeline queries (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_automation_events_conversation_created ON whatsapp_automation_events(conversation_id, created_at DESC);

-- Comments
COMMENT ON TABLE whatsapp_automation_events IS 'Timeline of automation events in conversations (bot messages, button clicks, flows, campaigns)';
COMMENT ON COLUMN whatsapp_automation_events.event_type IS 'Type of event: bot_message, button_clicked, flow_entered, flow_exited, cta_clicked, campaign_triggered';
COMMENT ON COLUMN whatsapp_automation_events.event_data IS 'Event-specific data stored as JSON (button_id, flow_name, campaign_id, rule_name, etc.)';

