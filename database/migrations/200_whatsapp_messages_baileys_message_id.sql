-- Link CRM reminder/outbox rows to Baileys message ids so messages.update can set delivered/read
ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS baileys_message_id VARCHAR(128) NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_business_baileys_id
  ON whatsapp_messages (business_id, baileys_message_id)
  WHERE baileys_message_id IS NOT NULL;
