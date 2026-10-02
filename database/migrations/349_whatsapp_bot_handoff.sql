-- Human handoff for the shop's AI agent: a conversation can pause the bot (staff replied,
-- handoff requested, or paused by hand), and every message records who sent it.

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS bot_paused_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bot_paused_reason VARCHAR(16),
  ADD COLUMN IF NOT EXISTS handoff_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS after_hours_notified_on DATE;

ALTER TABLE whatsapp_conversation_messages
  ADD COLUMN IF NOT EXISTS sent_by VARCHAR(16),
  ADD COLUMN IF NOT EXISTS sent_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_handoff
  ON whatsapp_conversations (business_id, handoff_requested_at)
  WHERE handoff_requested_at IS NOT NULL;
