-- List messages in thread order: created_at then message_id for stable ordering on ties
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv_created_message
  ON whatsapp_conversation_messages (conversation_id, created_at, message_id);
