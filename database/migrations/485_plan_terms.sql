-- 485: plan terms, so an admin can change a plan "for everyone now" or "only for new customers".
-- Follows 484. Additive and idempotent; no existing row changes and nothing is deleted.
-- MUST run before the code that reads these columns is deployed (scripts/deploy-vps.sh runs db:migrate:pending first).
--
--   subscription_plan_terms                one snapshot of a plan's terms as they were just before an
--                                          "only new customers" save: the enabled features, every limit
--                                          (resolved, so a plan default is frozen too) and the cycle prices
--   business_module_subscriptions.plan_terms_id
--                                          NULL = the business is on the plan's current terms (every row today).
--                                          Set = it keeps the snapshot's features, limits and renewal price for
--                                          as long as it stays on that plan; any plan change clears it.
-- With no admin save made, no snapshot exists and no row is pinned, so nothing any customer is charged or allowed changes.

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS subscription_plan_terms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       VARCHAR(50) NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  -- JSON array of the enabled feature ids.
  features      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- JSON object { limit_key: integer } for every active limit of the registry at snapshot time.
  limits        JSONB NOT NULL DEFAULT '{}'::jsonb,
  price_monthly NUMERIC(10, 2),
  price_yearly  NUMERIC(10, 2),
  price_3year   NUMERIC(10, 2),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by    UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
  -- What the save was: 'features', 'limits' or 'prices'.
  reason        TEXT
);

CREATE INDEX IF NOT EXISTS idx_subscription_plan_terms_plan ON subscription_plan_terms (plan_id, created_at);

ALTER TABLE business_module_subscriptions
  ADD COLUMN IF NOT EXISTS plan_terms_id UUID REFERENCES subscription_plan_terms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bms_plan_terms
  ON business_module_subscriptions (plan_id, plan_terms_id)
  WHERE plan_terms_id IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE '485: plan terms ready (subscription_plan_terms, business_module_subscriptions.plan_terms_id)';
END $$;
