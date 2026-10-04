-- Migration 362: AiSensy-style ownership for the Connect shared inbox.
-- A chat is Active (bot handling), Requesting (needs a human) or Intervened (owned by one agent,
-- bot stopped). The owner is whatsapp_conversations.assigned_to. Resolve returns the chat to Active.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'whatsapp_conversations' AND column_name = 'inbox_state'
  ) THEN
    ALTER TABLE whatsapp_conversations
      ADD COLUMN inbox_state VARCHAR(16) NOT NULL DEFAULT 'active';

    -- One-time backfill from the old assignment/status fields.
    UPDATE whatsapp_conversations
       SET inbox_state = 'requesting'
     WHERE handoff_requested_at IS NOT NULL
       AND COALESCE(conversation_status, 'open') NOT IN ('closed', 'bot_resolved');

    UPDATE whatsapp_conversations
       SET inbox_state = 'intervened'
     WHERE inbox_state = 'active'
       AND assigned_to IS NOT NULL
       AND COALESCE(conversation_status, 'open') IN ('open', 'pending');
  END IF;
END $$;

ALTER TABLE whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_inbox_state_check;
ALTER TABLE whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_inbox_state_check
  CHECK (inbox_state IN ('active', 'requesting', 'intervened'));

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intervened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_inbox_state
  ON whatsapp_conversations (business_id, inbox_state, assigned_to);

CREATE TABLE IF NOT EXISTS whatsapp_conversation_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL
    CHECK (type IN ('intervened', 'transferred', 'taken_over', 'resolved', 'auto_resolved', 'requested', 'released')),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_events_conv
  ON whatsapp_conversation_events (conversation_id, created_at);

-- Agent Rules: an agent with rows here only sees unowned chats that carry one of these labels.
CREATE TABLE IF NOT EXISTS whatsapp_agent_label_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES whatsapp_conversation_labels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, user_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_agent_label_rules_user
  ON whatsapp_agent_label_rules (business_id, user_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS inbox_last_seen_at TIMESTAMPTZ;

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS whatsapp_auto_resolve_enabled BOOLEAN DEFAULT true;

-- Supervisors see every chat and can take over / transfer any chat. Only can_view is used.
-- Not granted to any role automatically; the primary admin always passes.
INSERT INTO permission_modules (module_key, module_name, description, display_order, is_active)
VALUES ('whatsapp_inbox_supervise', 'Supervise WhatsApp chats', 'See every WhatsApp chat, take over and transfer chats owned by other agents', 30, true)
ON CONFLICT (module_key) DO NOTHING;
