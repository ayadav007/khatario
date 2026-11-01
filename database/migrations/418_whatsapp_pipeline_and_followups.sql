-- 418: Connect sales pipeline and follow-up reminders on chats.
--
-- * whatsapp_pipeline_stages: each business's own stages (open / won / lost), in board order.
--   legacy_key ties a stage to the old whatsapp_conversations.lead_status value it replaced, so the
--   AI agent's "when qualified" choice and older filters keep working after a rename.
-- * whatsapp_conversations gains the deal: stage, value, expected close date, lost reason.
--   A chat with no stage is not on the board.
-- * whatsapp_followups: "remind me" on a chat, for one agent at one time.
-- * whatsapp_automation_events accepts 'stage_changed' for the chat timeline.

CREATE TABLE IF NOT EXISTS whatsapp_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(60) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT 'slate',
  position INTEGER NOT NULL DEFAULT 0,
  kind VARCHAR(8) NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'won', 'lost')),
  legacy_key VARCHAR(20) CHECK (legacy_key IS NULL OR legacy_key IN ('new', 'interested', 'follow_up', 'converted', 'lost')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_pipeline_stages_name_uniq
  ON whatsapp_pipeline_stages (business_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_pipeline_stages_legacy_uniq
  ON whatsapp_pipeline_stages (business_id, legacy_key) WHERE legacy_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_pipeline_stages_order_idx
  ON whatsapp_pipeline_stages (business_id, position);

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS stage_id UUID REFERENCES whatsapp_pipeline_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_value NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS expected_close_on DATE,
  ADD COLUMN IF NOT EXISTS lost_reason VARCHAR(200),
  ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_conversations_deal_value_check') THEN
    ALTER TABLE whatsapp_conversations
      ADD CONSTRAINT whatsapp_conversations_deal_value_check CHECK (deal_value IS NULL OR deal_value >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS whatsapp_conversations_stage_idx
  ON whatsapp_conversations (business_id, stage_id, stage_changed_at DESC) WHERE stage_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS whatsapp_followups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  assigned_to UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ NOT NULL,
  note VARCHAR(500),
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled')),
  -- Drop the reminder if the customer writes in after it was set.
  cancel_on_reply BOOLEAN NOT NULL DEFAULT false,
  notified_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS whatsapp_followups_agent_due_idx
  ON whatsapp_followups (business_id, assigned_to, due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS whatsapp_followups_unnotified_idx
  ON whatsapp_followups (due_at) WHERE status = 'pending' AND notified_at IS NULL;
CREATE INDEX IF NOT EXISTS whatsapp_followups_conversation_idx
  ON whatsapp_followups (conversation_id) WHERE status = 'pending';

ALTER TABLE whatsapp_automation_events DROP CONSTRAINT IF EXISTS valid_event_type;
ALTER TABLE whatsapp_automation_events DROP CONSTRAINT IF EXISTS whatsapp_automation_events_event_type_check;
ALTER TABLE whatsapp_automation_events
  ADD CONSTRAINT whatsapp_automation_events_event_type_check CHECK (event_type IN (
    'bot_message', 'button_clicked', 'flow_entered', 'flow_exited', 'cta_clicked', 'campaign_triggered', 'stage_changed'
  ));

-- Businesses whose chats already moved past "new" get the default stages, and those chats go on the board.
-- Everyone else gets the defaults the first time the pipeline is opened.
INSERT INTO whatsapp_pipeline_stages (business_id, name, color, position, kind, legacy_key)
SELECT b.business_id, d.name, d.color, d.position, d.kind, d.legacy_key
  FROM (
    SELECT DISTINCT business_id FROM whatsapp_conversations
     WHERE lead_status IN ('interested', 'follow_up', 'converted', 'lost') AND NOT COALESCE(is_group, false)
  ) b
 CROSS JOIN (VALUES
   ('New', 'blue', 0, 'open', 'new'),
   ('Interested', 'amber', 1, 'open', 'interested'),
   ('Follow up', 'violet', 2, 'open', 'follow_up'),
   ('Won', 'green', 3, 'won', 'converted'),
   ('Lost', 'red', 4, 'lost', 'lost')
 ) AS d(name, color, position, kind, legacy_key)
 WHERE NOT EXISTS (SELECT 1 FROM whatsapp_pipeline_stages s WHERE s.business_id = b.business_id);

UPDATE whatsapp_conversations c
   SET stage_id = s.id, stage_changed_at = COALESCE(c.updated_at, NOW())
  FROM whatsapp_pipeline_stages s
 WHERE s.business_id = c.business_id
   AND s.legacy_key = c.lead_status
   AND c.stage_id IS NULL
   AND c.lead_status IN ('interested', 'follow_up', 'converted', 'lost')
   AND NOT COALESCE(c.is_group, false);
