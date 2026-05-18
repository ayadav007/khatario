-- Add billing_cycle column to track whether subscription is monthly or yearly
ALTER TABLE business_subscriptions
    ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(10) DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly'));
