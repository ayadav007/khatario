-- 447: Connect leads table. The sales pipeline moves from WhatsApp chats onto leads.
--
-- * leads: one row per enquiry, with or without a chat. Carries the deal (stage, value, expected
--   close, lost reason), the source (first touch), the owner (salesperson) and when it opened and
--   closed. closed_at IS NULL means open; a business has at most one open lead per phone, so a
--   repeat enquiry joins the open lead and a closed lead leaves room for a fresh one.
-- * whatsapp_followups, whatsapp_lead_imports and whatsapp_automation_events gain lead_id.
--   Follow-ups and timeline events may now belong to a lead that has no chat, so their
--   conversation_id becomes nullable, with a check that a chat or a lead is set.
-- * Backfill: every chat on the board (stage_id set, not a group) becomes a lead carrying its
--   deal and source. Chats in a won or lost stage start closed. If two chats share a phone and are
--   both open, the most recently active one stays open and the other is closed as it is, so the
--   one-open-lead-per-phone index holds.
-- * The old pipeline columns on whatsapp_conversations stay one release for rollback and are no
--   longer written once the code moves over; a later migration drops them.

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  -- Digits with country code, normalised like normalizeLeadPhone.
  contact_phone VARCHAR(20) NOT NULL,
  contact_name VARCHAR(120),
  conversation_id UUID REFERENCES whatsapp_conversations(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  -- 'existing' = a customer matched by phone when the lead opened; never changes afterwards.
  lead_type VARCHAR(8) NOT NULL DEFAULT 'new' CHECK (lead_type IN ('new', 'existing')),
  stage_id UUID REFERENCES whatsapp_pipeline_stages(id) ON DELETE SET NULL,
  deal_value NUMERIC(14, 2) CHECK (deal_value IS NULL OR deal_value >= 0),
  expected_close_on DATE,
  lost_reason VARCHAR(200),
  stage_changed_at TIMESTAMPTZ,
  -- The salesperson; separate from who holds the chat in the inbox.
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- First touch. NULL = Direct.
  source VARCHAR(16) CHECK (source IS NULL OR source IN ('ctwa_ad', 'link', 'indiamart', 'lead_api', 'manual', 'call', 'walk_in')),
  source_detail JSONB,
  source_at TIMESTAMPTZ,
  note VARCHAR(1000),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set when the stage is won or lost; NULL = open.
  closed_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One open lead per business and phone: two inserts at once cannot both win.
CREATE UNIQUE INDEX IF NOT EXISTS leads_one_open_per_phone
  ON leads (business_id, contact_phone) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_board_idx
  ON leads (business_id, stage_id, stage_changed_at DESC);
CREATE INDEX IF NOT EXISTS leads_list_idx
  ON leads (business_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS leads_conversation_idx
  ON leads (business_id, conversation_id);
CREATE INDEX IF NOT EXISTS leads_customer_idx
  ON leads (business_id, customer_id);

COMMENT ON TABLE leads IS 'Connect sales pipeline: one row per enquiry; closed_at NULL = open';

-- Follow-ups, lead imports and timeline events point at the lead.
ALTER TABLE whatsapp_followups
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE whatsapp_lead_imports
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE whatsapp_automation_events
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS whatsapp_followups_lead_idx
  ON whatsapp_followups (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_automation_events_lead_idx
  ON whatsapp_automation_events (lead_id, created_at DESC) WHERE lead_id IS NOT NULL;

-- A lead with no chat can still have reminders and a timeline.
ALTER TABLE whatsapp_followups ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE whatsapp_automation_events ALTER COLUMN conversation_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_followups_chat_or_lead_check') THEN
    ALTER TABLE whatsapp_followups
      ADD CONSTRAINT whatsapp_followups_chat_or_lead_check CHECK (conversation_id IS NOT NULL OR lead_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_automation_events_chat_or_lead_check') THEN
    ALTER TABLE whatsapp_automation_events
      ADD CONSTRAINT whatsapp_automation_events_chat_or_lead_check CHECK (conversation_id IS NOT NULL OR lead_id IS NOT NULL);
  END IF;
END $$;

-- Backfill: one lead per chat on the board. Won and lost chats start closed. Of several open chats
-- on one phone only the most recently active stays open; the rest close as they are (no stage change).
INSERT INTO leads (
  business_id, contact_phone, contact_name, conversation_id, customer_id, lead_type,
  stage_id, deal_value, expected_close_on, lost_reason, stage_changed_at, owner_id,
  source, source_detail, source_at, opened_at, closed_at, last_activity_at
)
SELECT
  r.business_id, r.phone, left(r.whatsapp_display_name, 120), r.id, r.customer_id,
  CASE WHEN r.customer_id IS NOT NULL THEN 'existing' ELSE 'new' END,
  r.stage_id, r.deal_value, r.expected_close_on, r.lost_reason, r.stage_changed_at, r.assigned_to,
  r.source, r.source_detail, r.source_at,
  COALESCE(r.source_at, r.created_at, NOW()),
  CASE
    WHEN r.stage_kind <> 'open' THEN COALESCE(r.stage_changed_at, r.updated_at, NOW())
    WHEN r.rn > 1 THEN NOW()
    WHEN EXISTS (
      SELECT 1 FROM leads o WHERE o.business_id = r.business_id AND o.contact_phone = r.phone AND o.closed_at IS NULL
    ) THEN NOW()
    ELSE NULL
  END,
  COALESCE(r.last_message_at, r.updated_at, NOW())
FROM (
  SELECT c.*, s.kind AS stage_kind,
         d.phone,
         ROW_NUMBER() OVER (
           PARTITION BY c.business_id, d.phone, (s.kind = 'open')
           ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC NULLS LAST, c.id
         ) AS rn
    FROM whatsapp_conversations c
    JOIN whatsapp_pipeline_stages s ON s.id = c.stage_id
   CROSS JOIN LATERAL (
     -- Same steps as normalizeLeadPhone in lib/whatsapp/lead-sources.ts.
     SELECT CASE WHEN length(z.d) = 10 THEN '91' || z.d ELSE z.d END AS phone
       FROM (
         SELECT CASE WHEN length(y.d) = 11 AND y.d LIKE '0%' THEN substr(y.d, 2) ELSE y.d END AS d
           FROM (
             SELECT CASE WHEN x.d LIKE '00%' THEN substr(x.d, 3) ELSE x.d END AS d
               FROM (SELECT regexp_replace(c.from_number, '\D', '', 'g') AS d) x
           ) y
       ) z
   ) d
   WHERE NOT COALESCE(c.is_group, false)
     AND length(d.phone) BETWEEN 11 AND 15
     AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.conversation_id = c.id)
) r;

-- Reminders and imports follow their chat to its lead: the open one, else the newest.
UPDATE whatsapp_followups f
   SET lead_id = x.id
  FROM (
    SELECT DISTINCT ON (conversation_id) conversation_id, id
      FROM leads
     WHERE conversation_id IS NOT NULL
     ORDER BY conversation_id, (closed_at IS NULL) DESC, opened_at DESC
  ) x
 WHERE x.conversation_id = f.conversation_id
   AND f.lead_id IS NULL;

UPDATE whatsapp_lead_imports i
   SET lead_id = x.id
  FROM (
    SELECT DISTINCT ON (conversation_id) conversation_id, id
      FROM leads
     WHERE conversation_id IS NOT NULL
     ORDER BY conversation_id, (closed_at IS NULL) DESC, opened_at DESC
  ) x
 WHERE x.conversation_id = i.conversation_id
   AND i.lead_id IS NULL;

-- Auto-won: a final invoice or a confirmed sales order for a customer wins that customer's open
-- leads. A trigger rather than app code because invoices and sales orders are inserted from many
-- places. Only leads opened on or before the document date (India date) move, to the business's
-- first won stage by position; no won stage means nothing happens. The cheap guards run before the
-- error-swallowing block so writes that cannot win a lead never open a subtransaction; the block
-- swallows its own errors so a lead problem can never fail an invoice or an order. Leads another
-- session holds locked are skipped rather than waited for (a statement_timeout cancel is not caught
-- by WHEN OTHERS).
CREATE OR REPLACE FUNCTION leads_auto_won() RETURNS trigger AS $$
DECLARE
  v_reference text;
  v_date date;
  v_won_id uuid;
  v_won_name text;
  v_lead record;
BEGIN
  IF NEW.customer_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- A save that touches neither status nor customer changes nothing for leads.
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id THEN
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'invoices' THEN
    IF NEW.status IS DISTINCT FROM 'final' OR NEW.deleted_at IS NOT NULL
       OR COALESCE(NEW.document_type, 'tax_invoice') IN ('proforma_invoice', 'estimate', 'quotation', 'delivery_challan') THEN
      RETURN NULL;
    END IF;
    v_reference := NEW.invoice_number;
    v_date := NEW.invoice_date;
  ELSE
    IF NEW.status IN ('draft', 'cancelled') THEN
      RETURN NULL;
    END IF;
    v_reference := NEW.order_number;
    v_date := NEW.order_date;
  END IF;

  BEGIN
    SELECT id, name INTO v_won_id, v_won_name
      FROM whatsapp_pipeline_stages
     WHERE business_id = NEW.business_id AND kind = 'won'
     ORDER BY position, id
     LIMIT 1;
    IF v_won_id IS NULL THEN
      RETURN NULL;
    END IF;

    FOR v_lead IN
      SELECT l.id, l.conversation_id, s.name AS from_name
        FROM leads l
        LEFT JOIN whatsapp_pipeline_stages s ON s.id = l.stage_id
       WHERE l.business_id = NEW.business_id
         AND l.customer_id = NEW.customer_id
         AND l.closed_at IS NULL
         AND (l.opened_at AT TIME ZONE 'Asia/Kolkata')::date <= v_date
       ORDER BY l.opened_at
         FOR UPDATE OF l SKIP LOCKED
    LOOP
      UPDATE leads
         SET stage_id = v_won_id, stage_changed_at = NOW(), closed_at = NOW(), last_activity_at = NOW(), updated_at = NOW()
       WHERE id = v_lead.id;

      INSERT INTO whatsapp_automation_events (conversation_id, lead_id, business_id, event_type, event_data)
      VALUES (
        v_lead.conversation_id, v_lead.id, NEW.business_id, 'stage_changed',
        jsonb_build_object('from_stage', v_lead.from_name, 'to_stage', v_won_name, 'source', 'auto',
                           'reference', v_reference, 'lead_id', v_lead.id)
      );

      IF v_lead.conversation_id IS NOT NULL THEN
        -- 'converted' mirrors legacyStatusFor() for a won stage in lib/leads/core.ts.
        UPDATE whatsapp_conversations
           SET lead_status = 'converted', updated_at = CURRENT_TIMESTAMP
         WHERE id = v_lead.conversation_id AND business_id = NEW.business_id;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'leads_auto_won: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_leads_auto_won ON invoices;
CREATE TRIGGER invoices_leads_auto_won
  AFTER INSERT OR UPDATE OF status, customer_id ON invoices
  FOR EACH ROW EXECUTE FUNCTION leads_auto_won();

DROP TRIGGER IF EXISTS sales_orders_leads_auto_won ON sales_orders;
CREATE TRIGGER sales_orders_leads_auto_won
  AFTER INSERT OR UPDATE OF status, customer_id ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION leads_auto_won();
