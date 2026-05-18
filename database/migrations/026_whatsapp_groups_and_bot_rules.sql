-- Add group support to WhatsApp conversations
ALTER TABLE whatsapp_conversations 
  ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS group_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS group_jid VARCHAR(255), -- Full JID including @g.us
  ADD COLUMN IF NOT EXISTS participant_count INTEGER;

-- Update index to include is_group for filtering
CREATE INDEX IF NOT EXISTS idx_conversations_is_group ON whatsapp_conversations(is_group) WHERE is_group = true;

-- Bot Auto-Reply Rules Table
CREATE TABLE IF NOT EXISTS whatsapp_bot_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL, -- Rule name for identification
    trigger_type VARCHAR(20) NOT NULL DEFAULT 'keyword', -- 'keyword', 'exact_match', 'regex', 'all'
    trigger_value TEXT NOT NULL, -- The keyword, phrase, or regex pattern
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0, -- Higher priority rules are checked first
    response_type VARCHAR(20) NOT NULL DEFAULT 'text', -- 'text', 'list', 'button'
    response_message TEXT NOT NULL, -- The message to send
    response_options JSONB, -- For list/button messages: array of {id, title, description}
    next_rule_id UUID REFERENCES whatsapp_bot_rules(id) ON DELETE SET NULL, -- For chaining (optional)
    only_for_individuals BOOLEAN DEFAULT true, -- If true, don't respond to groups
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, name)
);

-- Bot Rule Chains: For mapping user selections to next rules
CREATE TABLE IF NOT EXISTS whatsapp_bot_rule_chains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_id UUID NOT NULL REFERENCES whatsapp_bot_rules(id) ON DELETE CASCADE,
    option_id VARCHAR(100) NOT NULL, -- The option ID from response_options
    next_rule_id UUID NOT NULL REFERENCES whatsapp_bot_rules(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(rule_id, option_id)
);

-- Indexes for bot rules
CREATE INDEX IF NOT EXISTS idx_bot_rules_business_id ON whatsapp_bot_rules(business_id);
CREATE INDEX IF NOT EXISTS idx_bot_rules_active ON whatsapp_bot_rules(business_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_bot_rules_priority ON whatsapp_bot_rules(business_id, priority DESC) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_bot_rule_chains_rule_id ON whatsapp_bot_rule_chains(rule_id);
CREATE INDEX IF NOT EXISTS idx_bot_rule_chains_next_rule_id ON whatsapp_bot_rule_chains(next_rule_id);

-- Update trigger for whatsapp_bot_rules
DROP TRIGGER IF EXISTS update_whatsapp_bot_rules_updated_at ON whatsapp_bot_rules;
CREATE OR REPLACE FUNCTION update_whatsapp_bot_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_whatsapp_bot_rules_updated_at
    BEFORE UPDATE ON whatsapp_bot_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_bot_rules_updated_at();

