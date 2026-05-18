-- Ensure Free / Starter plan allows purchases with a non-zero monthly limit.
-- Admin UI shows COALESCE(plan_limit, default_value); enforcement now matches.

INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
VALUES ('free', 'purchase_management', true)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;

INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
SELECT 'free', 'max_purchases_per_month', COALESCE(pl.default_value, 10)
FROM platform_limits pl
WHERE pl.limit_key = 'max_purchases_per_month' AND pl.is_active = true
ON CONFLICT (plan_id, limit_key) DO UPDATE
  SET limit_value = EXCLUDED.limit_value;

INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
SELECT 'free', 'max_suppliers', COALESCE(pl.default_value, 10)
FROM platform_limits pl
WHERE pl.limit_key = 'max_suppliers' AND pl.is_active = true
ON CONFLICT (plan_id, limit_key) DO UPDATE
  SET limit_value = EXCLUDED.limit_value;
