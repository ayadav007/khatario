-- Per-shop WhatsApp AI agent behaviour: profile, tone and business rules, fallback/handoff
-- messages and the lead qualification skill. Provider and key stay in ai_provider_config.

CREATE TABLE IF NOT EXISTS ai_agent_settings (
    business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    agent_name VARCHAR(120),
    greeting_message TEXT,
    business_summary TEXT,
    instructions TEXT CHECK (instructions IS NULL OR char_length(instructions) <= 2000),
    behavior JSONB NOT NULL DEFAULT '{}'::jsonb,
    fallback_message TEXT,
    after_hours_message TEXT,
    post_payment_message TEXT,
    handoff JSONB NOT NULL DEFAULT '{}'::jsonb,
    lead_skill JSONB NOT NULL DEFAULT '{}'::jsonb,
    skills JSONB NOT NULL DEFAULT '{}'::jsonb,
    quick_replies_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    setup_completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);
