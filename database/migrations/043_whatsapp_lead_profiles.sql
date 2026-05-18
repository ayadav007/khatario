-- Migration: 043_whatsapp_lead_profiles.sql
-- Purpose: Store AI-generated lead profiles and insights from WhatsApp conversations
-- This enables automatic lead scoring and qualification

-- Create whatsapp_lead_profiles table
CREATE TABLE IF NOT EXISTS whatsapp_lead_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    phone VARCHAR(20) NOT NULL,
    
    -- Lead Scoring
    lead_score INTEGER DEFAULT 0 CHECK (lead_score >= 0 AND lead_score <= 100), -- 0-100 score
    lead_status VARCHAR(20) DEFAULT 'cold', -- 'hot', 'warm', 'cold', 'not_interested'
    interest_level VARCHAR(20) DEFAULT 'low', -- 'high', 'medium', 'low', 'none'
    
    -- Behavior Analysis
    behavior_tags JSONB DEFAULT '[]'::jsonb, -- ['price_sensitive', 'discount_seeker', 'urgent_buyer', 'comparison_shopper', 'loyal_customer', 'complainer', 'inquirer']
    sentiment VARCHAR(20) DEFAULT 'neutral', -- 'positive', 'neutral', 'negative'
    
    -- Conversation Insights
    key_topics JSONB DEFAULT '[]'::jsonb, -- Topics discussed: ['pricing', 'delivery', 'product_features', 'support']
    purchase_intent INTEGER DEFAULT 0 CHECK (purchase_intent >= 0 AND purchase_intent <= 100), -- 0-100
    urgency_level VARCHAR(20) DEFAULT 'low', -- 'high', 'medium', 'low'
    
    -- AI-Generated Summary
    ai_summary TEXT, -- Brief AI-generated summary of the lead
    ai_insights JSONB DEFAULT '{}'::jsonb, -- Additional structured insights
    
    -- Conversation Stats
    total_messages INTEGER DEFAULT 0,
    response_rate DECIMAL(5,2), -- Percentage of messages responded to
    avg_response_time INTEGER, -- Average response time in seconds
    last_analyzed_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(business_id, conversation_id)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_lead_profiles_business_id ON whatsapp_lead_profiles(business_id);
CREATE INDEX IF NOT EXISTS idx_lead_profiles_customer_id ON whatsapp_lead_profiles(customer_id);
CREATE INDEX IF NOT EXISTS idx_lead_profiles_lead_score ON whatsapp_lead_profiles(lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_lead_profiles_lead_status ON whatsapp_lead_profiles(lead_status);
CREATE INDEX IF NOT EXISTS idx_lead_profiles_phone ON whatsapp_lead_profiles(phone);
CREATE INDEX IF NOT EXISTS idx_lead_profiles_behavior_tags ON whatsapp_lead_profiles USING GIN(behavior_tags);
CREATE INDEX IF NOT EXISTS idx_lead_profiles_key_topics ON whatsapp_lead_profiles USING GIN(key_topics);
CREATE INDEX IF NOT EXISTS idx_lead_profiles_conversation_id ON whatsapp_lead_profiles(conversation_id);

-- Update trigger
CREATE OR REPLACE FUNCTION update_whatsapp_lead_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_whatsapp_lead_profiles_updated_at
    BEFORE UPDATE ON whatsapp_lead_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_lead_profiles_updated_at();

-- Comments for documentation
COMMENT ON TABLE whatsapp_lead_profiles IS 'AI-generated lead profiles and insights from WhatsApp conversations';
COMMENT ON COLUMN whatsapp_lead_profiles.lead_score IS 'Lead quality score from 0-100 based on engagement and purchase intent';
COMMENT ON COLUMN whatsapp_lead_profiles.lead_status IS 'Lead temperature: hot (ready to buy), warm (interested), cold (minimal interest), not_interested';
COMMENT ON COLUMN whatsapp_lead_profiles.behavior_tags IS 'Array of behavior patterns detected by AI (e.g., price_sensitive, discount_seeker)';
COMMENT ON COLUMN whatsapp_lead_profiles.sentiment IS 'Overall sentiment of customer: positive, neutral, negative';
COMMENT ON COLUMN whatsapp_lead_profiles.purchase_intent IS 'AI-assessed purchase likelihood from 0-100';
COMMENT ON COLUMN whatsapp_lead_profiles.ai_summary IS 'AI-generated summary of the lead and conversation';
COMMENT ON COLUMN whatsapp_lead_profiles.ai_insights IS 'Structured insights including recommended actions, concerns, etc.';
