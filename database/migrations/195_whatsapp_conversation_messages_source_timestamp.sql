-- Original WhatsApp messageTimestamp (when known); created_at is normalized display/ordering time
ALTER TABLE whatsapp_conversation_messages
  ADD COLUMN IF NOT EXISTS source_timestamp TIMESTAMPTZ NULL;

COMMENT ON COLUMN whatsapp_conversation_messages.source_timestamp IS
  'WhatsApp proto messageTimestamp (UTC) when available; may differ from created_at if normalized/fallback applied';
