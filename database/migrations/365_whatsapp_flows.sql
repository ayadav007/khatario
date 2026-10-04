-- WhatsApp Flows: canvas definitions, live sessions, inbound routing log.
-- Sessions are keyed by conversation UUID so they never overwrite shop waiting_payment
-- state in whatsapp_conversation_states (phone-keyed).

CREATE TABLE IF NOT EXISTS whatsapp_flows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'inactive')),
    version INTEGER NOT NULL DEFAULT 1,
    definition JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_definition JSONB,
    triggers JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (business_id, name)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_flows_business_status
    ON whatsapp_flows (business_id, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_flows_triggers
    ON whatsapp_flows USING GIN (triggers);

CREATE TABLE IF NOT EXISTS whatsapp_flow_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    flow_id UUID NOT NULL REFERENCES whatsapp_flows(id) ON DELETE CASCADE,
    flow_version INTEGER NOT NULL,
    current_node_id TEXT NOT NULL,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'ended', 'expired')),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_flow_sessions_one_active
    ON whatsapp_flow_sessions (conversation_id)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_whatsapp_flow_sessions_business
    ON whatsapp_flow_sessions (business_id, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_flow_sessions_expires
    ON whatsapp_flow_sessions (expires_at)
    WHERE status = 'active';

CREATE TABLE IF NOT EXISTS whatsapp_inbound_routing_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES whatsapp_conversations(id) ON DELETE SET NULL,
    message_id TEXT,
    handler VARCHAR(40) NOT NULL,
    flow_id UUID REFERENCES whatsapp_flows(id) ON DELETE SET NULL,
    reason TEXT,
    confidence NUMERIC(4, 3),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_routing_events_conv
    ON whatsapp_inbound_routing_events (business_id, conversation_id, created_at DESC);

CREATE OR REPLACE FUNCTION update_whatsapp_flows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_whatsapp_flows_updated_at ON whatsapp_flows;
CREATE TRIGGER update_whatsapp_flows_updated_at
    BEFORE UPDATE ON whatsapp_flows
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_flows_updated_at();
