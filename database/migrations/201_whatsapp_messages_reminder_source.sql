-- Distinguish manual vs auto (payment_due / overdue) for Reminder History
ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS reminder_source VARCHAR(32) NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_reminder_source
  ON whatsapp_messages (business_id, reminder_source)
  WHERE reminder_source IS NOT NULL;
