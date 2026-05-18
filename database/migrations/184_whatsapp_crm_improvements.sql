-- Migration: 184_whatsapp_crm_improvements.sql
-- Purpose: Add saved replies, auto-assignment settings, and bot_resolved conversation status

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Saved Replies (Canned Responses)
--    Agents can type "/" in the composer to pick from pre-written replies.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_saved_replies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL,               -- Short label, shown in picker
    shortcut VARCHAR(50),                       -- Optional "/" shortcut keyword
    message TEXT NOT NULL,                      -- Full reply text
    category VARCHAR(100) DEFAULT 'general',   -- e.g. "orders", "payments", "support"
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, title)
);

CREATE INDEX IF NOT EXISTS idx_saved_replies_business_id ON whatsapp_saved_replies(business_id);
CREATE INDEX IF NOT EXISTS idx_saved_replies_shortcut ON whatsapp_saved_replies(business_id, shortcut) WHERE shortcut IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_saved_replies_category ON whatsapp_saved_replies(business_id, category);

CREATE OR REPLACE FUNCTION update_saved_replies_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_saved_replies_updated_at ON whatsapp_saved_replies;
CREATE TRIGGER trigger_saved_replies_updated_at
    BEFORE UPDATE ON whatsapp_saved_replies
    FOR EACH ROW EXECUTE FUNCTION update_saved_replies_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Auto-Assignment Settings
--    Per-business round-robin or manual assignment policy.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE business_settings
    ADD COLUMN IF NOT EXISTS whatsapp_auto_assign_enabled BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS whatsapp_auto_assign_mode VARCHAR(20) DEFAULT 'round_robin',
    ADD COLUMN IF NOT EXISTS whatsapp_auto_assign_agent_ids JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS whatsapp_auto_assign_last_index INTEGER DEFAULT 0;

COMMENT ON COLUMN business_settings.whatsapp_auto_assign_enabled IS 'Enable auto-assignment of new conversations to agents';
COMMENT ON COLUMN business_settings.whatsapp_auto_assign_mode IS 'Assignment mode: round_robin (default) or least_loaded';
COMMENT ON COLUMN business_settings.whatsapp_auto_assign_agent_ids IS 'Ordered list of user UUIDs included in the assignment pool';
COMMENT ON COLUMN business_settings.whatsapp_auto_assign_last_index IS 'Index into agent pool for round-robin pointer';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Bot-Resolved Conversation Status
--    Add "bot_resolved" to the allowed values so bot-only flows don't pollute
--    the human agent inbox.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE whatsapp_conversations
    DROP CONSTRAINT IF EXISTS whatsapp_conversations_conversation_status_check;

ALTER TABLE whatsapp_conversations
    ADD CONSTRAINT whatsapp_conversations_conversation_status_check
    CHECK (conversation_status IN ('open', 'pending', 'closed', 'bot_resolved'));

COMMENT ON COLUMN whatsapp_conversations.conversation_status IS
  'Conversation workflow status: open, pending, closed (human), bot_resolved (fully handled by bot)';
