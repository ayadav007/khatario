-- Enhance bot rules table with advanced features
-- Add columns for conditions, actions, context variables, and enhanced triggers

-- Add new columns to whatsapp_bot_rules
ALTER TABLE whatsapp_bot_rules
  ADD COLUMN IF NOT EXISTS trigger_conditions JSONB, -- Advanced conditions (label, sender type, inactivity, etc.)
  ADD COLUMN IF NOT EXISTS auto_actions JSONB, -- Auto actions (add label, remove label, assign, create lead, etc.)
  ADD COLUMN IF NOT EXISTS fallback_message TEXT, -- Fallback message if invalid input
  ADD COLUMN IF NOT EXISTS expected_input_type VARCHAR(50), -- text, number, yes/no, email, phone, menu_option
  ADD COLUMN IF NOT EXISTS context_variables JSONB, -- Variables to extract and store (name, phone, email, etc.)
  ADD COLUMN IF NOT EXISTS response_media_url TEXT, -- For image, video, file responses
  ADD COLUMN IF NOT EXISTS response_media_type VARCHAR(20), -- image, video, document, audio
  ADD COLUMN IF NOT EXISTS category VARCHAR(100), -- Category/group for rules (Welcome, FAQ, Pricing, CRM, etc.)
  ADD COLUMN IF NOT EXISTS end_flow BOOLEAN DEFAULT false, -- End conversation flow after this rule
  ADD COLUMN IF NOT EXISTS delay_seconds INTEGER DEFAULT 0; -- Delay before sending response (typing simulator)

-- Update trigger_type to support more options
-- Existing: 'keyword', 'exact_match', 'regex', 'all'
-- New: 'starts_with', 'ends_with', 'match_all_keywords', 'match_any_keyword', 
--      'first_message', 'message_type', 'scheduled', 'inactivity'

-- Update response_type to support more options  
-- Existing: 'text', 'list', 'button'
-- New: 'image', 'video', 'document', 'audio', 'template', 'emoji'

-- Example structure for trigger_conditions JSONB:
-- {
--   "required_label_ids": ["uuid1", "uuid2"],
--   "excluded_label_ids": ["uuid3"],
--   "min_inactivity_minutes": 60,
--   "sender_types": ["individual", "group"],
--   "conversation_state": "idle"
-- }

-- Example structure for auto_actions JSONB:
-- {
--   "add_labels": ["uuid1", "uuid2"],
--   "remove_labels": ["uuid3"],
--   "assign_to_user_id": "uuid",
--   "create_lead": true,
--   "update_crm_field": {"field": "status", "value": "contacted"},
--   "send_followup_after_minutes": 30,
--   "save_context": {"name": "{{message}}", "phone": "{{phone}}"}
-- }

-- Example structure for context_variables JSONB:
-- {
--   "extract": ["name", "phone", "email", "budget"],
--   "store_as": {"customer_name": "name", "contact_phone": "phone"}
-- }

-- Add index for category
CREATE INDEX IF NOT EXISTS idx_bot_rules_category ON whatsapp_bot_rules(business_id, category);

-- Add index for trigger_conditions
CREATE INDEX IF NOT EXISTS idx_bot_rules_conditions ON whatsapp_bot_rules USING GIN (trigger_conditions);

