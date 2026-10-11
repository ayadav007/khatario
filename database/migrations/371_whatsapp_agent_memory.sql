-- Memory the WhatsApp AI agent reads on every reply: facts already collected and a short
-- summary of the rest of the chat. Scoped to the conversation row (business_id stays on that row).

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS agent_memory JSONB;

COMMENT ON COLUMN whatsapp_conversations.agent_memory IS
  'Agent memory for this chat: collected facts (name, contact, items) and a rolling summary.';
