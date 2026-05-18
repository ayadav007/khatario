-- Migration 185: WhatsApp message reactions
-- Stores emoji reactions sent by participants on individual messages

CREATE TABLE IF NOT EXISTS whatsapp_message_reactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  message_id       TEXT NOT NULL,          -- WhatsApp message ID (wa_message_id)
  sender_jid       TEXT NOT NULL,          -- JID of person who reacted
  reaction         TEXT NOT NULL,          -- The emoji (empty string = remove reaction)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Only one active reaction per sender per message (upsert target)
  UNIQUE (business_id, message_id, sender_jid)
);

CREATE INDEX IF NOT EXISTS idx_wa_reactions_message
  ON whatsapp_message_reactions (business_id, message_id);

CREATE INDEX IF NOT EXISTS idx_wa_reactions_conversation
  ON whatsapp_message_reactions (conversation_id);
