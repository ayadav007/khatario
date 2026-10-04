-- Migration 359: business_module_subscriptions becomes the only subscription record.
-- Adds the columns that so far lived only on business_subscriptions, copies them onto each
-- business's primary-module row, and creates module rows for any business that still has none.
-- business_subscriptions itself is left in place (no longer read or written) and dropped later.

ALTER TABLE business_module_subscriptions
  ADD COLUMN IF NOT EXISTS trial_extension_granted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_extension_declined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS downgraded_from VARCHAR(50);

-- Businesses that never got a module row (pre-256 data that slipped through).
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
  COALESCE(bs.start_date, CURRENT_DATE),
  bs.end_date,
  bs.trial_end_date,
  COALESCE(bs.billing_cycle, 'monthly'),
  bs.scheduled_plan_id,
  bs.grace_period_end,
  COALESCE(bs.cancel_at_period_end, false)
FROM business_subscriptions bs
JOIN subscription_plans sp ON sp.id = bs.plan_id
WHERE bs.status IN ('active', 'trial', 'expired', 'cancelled')
  AND NOT EXISTS (
    SELECT 1 FROM business_module_subscriptions m WHERE m.business_id = bs.business_id
  )
ON CONFLICT (business_id, module_key) DO NOTHING;

INSERT INTO business_modules (business_id, module_key, enabled, source)
SELECT bms.business_id, bms.module_key, true, 'backfill_359'
FROM business_module_subscriptions bms
ON CONFLICT (business_id, module_key) DO NOTHING;

-- Carry the legacy-only fields onto the primary-module row. Rows already written by the new code
-- are skipped so a re-run cannot overwrite them with stale legacy values.
UPDATE business_module_subscriptions m
SET trial_extension_granted = COALESCE(bs.trial_extension_granted, false),
    trial_extension_declined_at = bs.trial_extension_declined_at,
    cancelled_at = bs.cancelled_at,
    downgraded_from = bs.downgraded_from
FROM business_subscriptions bs
JOIN businesses b ON b.id = bs.business_id
WHERE m.business_id = bs.business_id
  AND m.module_key = COALESCE(b.primary_module, 'billing')
  AND m.trial_extension_granted = false
  AND m.trial_extension_declined_at IS NULL
  AND m.cancelled_at IS NULL
  AND m.downgraded_from IS NULL;

COMMENT ON TABLE business_module_subscriptions IS
  'The only subscription record: one plan row per product module (billing, hr, connect). business_subscriptions is legacy and unused.';
