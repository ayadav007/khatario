-- 446: Every new number that messages a business becomes a lead, and each lead keeps a summary.
--
-- * business_settings.whatsapp_add_new_chats_to_pipeline: a 1:1 chat from a number that is not a
--   customer, supplier or the owner goes on the pipeline's first open stage when it starts, like
--   the tracked sources already do. On by default; a business without a settings row counts as on.
-- * whatsapp_conversations.summary_due_at: when the chat's lead summary should be rewritten. Every
--   message in or out (customer, bot or staff) pushes it to a few minutes ahead, so the summary is
--   written once the chat goes quiet instead of after every message. The whatsapp-followups cron
--   claims due rows and clears the column.

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS whatsapp_add_new_chats_to_pipeline BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN business_settings.whatsapp_add_new_chats_to_pipeline IS
  'Put a new 1:1 chat from an unknown number on the first open pipeline stage';

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS summary_due_at TIMESTAMPTZ;

COMMENT ON COLUMN whatsapp_conversations.summary_due_at IS
  'Rewrite the lead summary at this time (set to a few minutes after the latest message); NULL = up to date';

CREATE INDEX IF NOT EXISTS whatsapp_conversations_summary_due_idx
  ON whatsapp_conversations (summary_due_at) WHERE summary_due_at IS NOT NULL;
