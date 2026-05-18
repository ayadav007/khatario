-- Fix missing column in businesses table
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS next_sales_order_number INTEGER DEFAULT 1;

-- Increase phone number column lengths to accommodate full JIDs and normalized numbers
-- Note: conversation_id in whatsapp_conversation_messages is UUID (foreign key), NOT phone number
-- The phone number is stored in from_number/to_number columns

-- whatsapp_conversations
-- conversation_id here IS the phone number (VARCHAR), not the UUID primary key
ALTER TABLE whatsapp_conversations ALTER COLUMN conversation_id TYPE VARCHAR(100);
ALTER TABLE whatsapp_conversations ALTER COLUMN from_number TYPE VARCHAR(100);
ALTER TABLE whatsapp_conversations ALTER COLUMN to_number TYPE VARCHAR(100);
ALTER TABLE whatsapp_conversations ALTER COLUMN last_message_text TYPE TEXT; -- Avoid truncation

-- whatsapp_conversation_messages
-- IMPORTANT: conversation_id here is UUID (foreign key to whatsapp_conversations.id), DO NOT change it!
-- Only change from_number, to_number (phone numbers)
ALTER TABLE whatsapp_conversation_messages ALTER COLUMN from_number TYPE VARCHAR(100);
ALTER TABLE whatsapp_conversation_messages ALTER COLUMN to_number TYPE VARCHAR(100);
ALTER TABLE whatsapp_conversation_messages ALTER COLUMN message_text TYPE TEXT;

-- whatsapp_messages (common for manual sends)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'whatsapp_messages') THEN
        -- Check if from_number exists (it might not in older schemas)
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'whatsapp_messages' AND column_name = 'from_number') THEN
            ALTER TABLE whatsapp_messages ALTER COLUMN from_number TYPE VARCHAR(100);
        END IF;
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'whatsapp_messages' AND column_name = 'to_number') THEN
            ALTER TABLE whatsapp_messages ALTER COLUMN to_number TYPE VARCHAR(100);
        END IF;
        -- message_text might be called message_text or content depending on schema version
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'whatsapp_messages' AND column_name = 'message_text') THEN
            ALTER TABLE whatsapp_messages ALTER COLUMN message_text TYPE TEXT;
        END IF;
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'whatsapp_messages' AND column_name = 'content') THEN
            ALTER TABLE whatsapp_messages ALTER COLUMN content TYPE TEXT;
        END IF;
    END IF;
END $$;

-- whatsapp_lead_profiles
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'whatsapp_lead_profiles') THEN
        ALTER TABLE whatsapp_lead_profiles ALTER COLUMN phone TYPE VARCHAR(100);
    END IF;
END $$;

-- whatsapp_pending_orders (if it exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'whatsapp_pending_orders') THEN
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'whatsapp_pending_orders' AND column_name = 'phone') THEN
            ALTER TABLE whatsapp_pending_orders ALTER COLUMN phone TYPE VARCHAR(100);
        END IF;
    END IF;
END $$;

-- whatsapp_conversation_states (conversation_id here is phone number, not UUID)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'whatsapp_conversation_states') THEN
        ALTER TABLE whatsapp_conversation_states ALTER COLUMN conversation_id TYPE VARCHAR(100);
    END IF;
END $$;
