-- 452: Lead comments are chat notes with a lead.
--
-- * whatsapp_conversation_notes.lead_id: the enquiry a note belongs to. A note written on a chat files under the
--   chat's open lead; a note written on a lead stays with it, and the chat shows it once one links.
-- * conversation_id becomes optional, so a lead with no chat (call, walk-in, IndiaMART) can carry notes too.
--   Every note still has a chat or a lead.
-- * user_id becomes optional: it was NOT NULL with ON DELETE SET NULL, so deleting a staff member who had written
--   notes failed. The note now stays, without an author.
-- * Existing notes file under the lead that was open on their chat when they were written; older ones stay chat-only.
-- Re-runnable. Needs migration 447.

ALTER TABLE whatsapp_conversation_notes
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE whatsapp_conversation_notes ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE whatsapp_conversation_notes ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_conversation_notes_chat_or_lead_check') THEN
    ALTER TABLE whatsapp_conversation_notes
      ADD CONSTRAINT whatsapp_conversation_notes_chat_or_lead_check
      CHECK (conversation_id IS NOT NULL OR lead_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS whatsapp_conversation_notes_lead_idx
  ON whatsapp_conversation_notes (lead_id, created_at DESC) WHERE lead_id IS NOT NULL;

COMMENT ON COLUMN whatsapp_conversation_notes.lead_id IS 'The enquiry (lead) this note belongs to; NULL = a general chat note';

UPDATE whatsapp_conversation_notes n
   SET lead_id = (
     SELECT l.id FROM leads l
      WHERE l.business_id = n.business_id
        AND l.conversation_id = n.conversation_id
        AND l.opened_at <= n.created_at::timestamptz
        AND (l.closed_at IS NULL OR l.closed_at >= n.created_at::timestamptz)
      ORDER BY l.opened_at DESC
      LIMIT 1
   )
 WHERE n.lead_id IS NULL AND n.conversation_id IS NOT NULL;
