-- Add scheduled_plan_id for deferred downgrades (downgrade at end of billing period)
ALTER TABLE business_subscriptions
    ADD COLUMN IF NOT EXISTS scheduled_plan_id VARCHAR(50);
