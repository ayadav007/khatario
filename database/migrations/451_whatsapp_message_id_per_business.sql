-- 451: A WhatsApp message id is unique per business, not across Khatario (phase 1 of 2).
--
-- When two Khatario businesses message each other (Supplier Hub, or any two tenants), WhatsApp gives the message one
-- id, and it is stored twice: outgoing in the sender's inbox, incoming in the receiver's. The old global
-- UNIQUE (message_id) made the second write collide with the first business's row, and the sender's
-- "ON CONFLICT (message_id) DO UPDATE" overwrote the receiver's text and status.
--
-- Phase 1 (this migration, shipped with the code that uses it): add the per-business key. lib/whatsapp-crm.ts now
-- inserts with ON CONFLICT DO NOTHING and updates only its own business's row, so no business can overwrite
-- another's message from this deploy on. The old constraint stays, because scripts/deploy-vps.sh runs migrations
-- before the build and the old code's ON CONFLICT (message_id) needs it until the new code is live.
-- While it stays, the second business's copy of a cross-tenant message is skipped rather than stored.
--
-- Phase 2 (a later migration, in the deploy AFTER this one is live): drop the global constraint so both copies are
-- stored — SQL in docs/SERVER_INFRASTRUCTURE.md ("Message ids per business").
--
-- Existing rows are already unique by message_id alone, so the new index cannot fail on old data.
-- The index build blocks writes to whatsapp_conversation_messages while it runs: apply in a quiet window.

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversation_messages_business_message_uniq
  ON whatsapp_conversation_messages (business_id, message_id);
