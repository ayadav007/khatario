-- Migration: 042_ai_provider_config.sql
-- Purpose: Store AI provider configuration per business
-- This allows each business to use their own AI provider (OpenAI, Gemini, Groq, Custom)

-- Create AI provider configuration table
CREATE TABLE IF NOT EXISTS ai_provider_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- Provider Selection
    provider VARCHAR(50) NOT NULL DEFAULT 'groq', -- 'openai', 'gemini', 'groq', 'anthropic', 'custom'
    
    -- API Configuration (encrypt in production)
    api_key TEXT NOT NULL, -- User's API key
    api_base_url TEXT, -- Custom base URL for custom providers
    model VARCHAR(100), -- Model name (e.g., 'gpt-4', 'gemini-pro', 'llama-3.1-8b-instant')
    
    -- Feature Toggles
    chatbot_enabled BOOLEAN DEFAULT true,
    lead_analyzer_enabled BOOLEAN DEFAULT true,
    hsn_validator_enabled BOOLEAN DEFAULT false, -- Optional: allow users to use their own for HSN too
    
    -- Settings
    temperature DECIMAL(3,2) DEFAULT 0.7, -- 0.0 to 2.0
    max_tokens INTEGER DEFAULT 500,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(business_id)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_ai_provider_config_business_id ON ai_provider_config(business_id);
CREATE INDEX IF NOT EXISTS idx_ai_provider_config_provider ON ai_provider_config(provider);

-- Update trigger
CREATE OR REPLACE FUNCTION update_ai_provider_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_ai_provider_config_updated_at
    BEFORE UPDATE ON ai_provider_config
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_provider_config_updated_at();

-- Comments for documentation
COMMENT ON TABLE ai_provider_config IS 'Stores AI provider configuration per business for sales agent chatbot';
COMMENT ON COLUMN ai_provider_config.provider IS 'AI provider: openai, gemini, groq, anthropic, or custom';
COMMENT ON COLUMN ai_provider_config.api_key IS 'Business-specific API key (should be encrypted in production)';
COMMENT ON COLUMN ai_provider_config.model IS 'Model name to use with the provider';
COMMENT ON COLUMN ai_provider_config.chatbot_enabled IS 'Enable/disable AI sales agent chatbot';
COMMENT ON COLUMN ai_provider_config.lead_analyzer_enabled IS 'Enable/disable automatic lead profiling';
