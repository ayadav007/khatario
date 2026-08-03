-- Migration 256: Per-module subscriptions (Billing, HR, Connect each have their own plan row)

CREATE TABLE IF NOT EXISTS business_module_subscriptions (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  module_key VARCHAR(32) NOT NULL,
  plan_id VARCHAR(50) NOT NULL REFERENCES subscription_plans(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  trial_end_date DATE,
  billing_cycle VARCHAR(20) DEFAULT 'monthly',
  scheduled_plan_id VARCHAR(50) REFERENCES subscription_plans(id),
  grace_period_end DATE,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, module_key),
  CONSTRAINT business_module_subscriptions_module_key_check
    CHECK (module_key IN ('billing', 'hr', 'connect', 'crm')),
  CONSTRAINT business_module_subscriptions_status_check
    CHECK (status IN ('active', 'expired', 'cancelled', 'trial'))
);

CREATE INDEX IF NOT EXISTS idx_business_module_subscriptions_business
  ON business_module_subscriptions(business_id);

COMMENT ON TABLE business_module_subscriptions IS
  'One subscription plan per product module; account-wide console seats use MAX(max_users) across active modules.';

-- Backfill from legacy single-row subscription + enabled modules
INSERT INTO business_module_subscriptions (
  business_id, module_key, plan_id, status, start_date, end_date, trial_end_date,
  billing_cycle, scheduled_plan_id, grace_period_end, cancel_at_period_end
)
SELECT
  bs.business_id,
  CASE
    WHEN sp.product_line = 'hr' THEN 'hr'
    WHEN sp.product_line = 'connect' THEN 'connect'
    ELSE 'billing'
  END,
  bs.plan_id,
  bs.status,
  bs.start_date,
  bs.end_date,
  bs.trial_end_date,
  COALESCE(bs.billing_cycle, 'monthly'),
  bs.scheduled_plan_id,
  bs.grace_period_end,
  COALESCE(bs.cancel_at_period_end, false)
FROM business_subscriptions bs
JOIN subscription_plans sp ON sp.id = bs.plan_id
WHERE bs.status IN ('active', 'trial', 'expired', 'cancelled')
ON CONFLICT (business_id, module_key) DO NOTHING;

-- Ensure business_modules rows exist for backfilled subs
INSERT INTO business_modules (business_id, module_key, enabled, source)
SELECT bms.business_id, bms.module_key, true, 'backfill_256'
FROM business_module_subscriptions bms
ON CONFLICT (business_id, module_key) DO NOTHING;
