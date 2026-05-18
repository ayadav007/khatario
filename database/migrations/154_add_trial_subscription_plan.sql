-- Plan A: dedicated `trial` subscription plan (entitlements cloned from enterprise, else business).
-- New signups use plan_id = trial + status = trial; cron downgrades to free after trial_end_date + grace.

DO $$
DECLARE
  src_plan VARCHAR(50);
BEGIN
  IF EXISTS (SELECT 1 FROM subscription_plans WHERE id = 'enterprise' AND is_active = true) THEN
    src_plan := 'enterprise';
  ELSIF EXISTS (SELECT 1 FROM subscription_plans WHERE id = 'business' AND is_active = true) THEN
    src_plan := 'business';
  ELSE
    RAISE NOTICE '154_add_trial_subscription_plan: no enterprise/business plan; skip trial plan';
    RETURN;
  END IF;

  INSERT INTO subscription_plans (
    id, name, display_name, description,
    price_monthly, price_yearly, currency, features, is_active, sort_order, registry_complete
  )
  SELECT
    'trial',
    'trial',
    'Trial',
    'New account trial: full access during your trial window, then Free unless you subscribe.',
    0,
    0,
    currency,
    features,
    true,
    5,
    false
  FROM subscription_plans
  WHERE id = src_plan
  LIMIT 1
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    features = EXCLUDED.features,
    is_active = true,
    sort_order = EXCLUDED.sort_order,
    registry_complete = EXCLUDED.registry_complete,
    updated_at = CURRENT_TIMESTAMP;

  DELETE FROM subscription_plan_features WHERE plan_id = 'trial';
  INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
  SELECT 'trial', feature_id, enabled
  FROM subscription_plan_features
  WHERE plan_id = src_plan;

  DELETE FROM subscription_plan_limits WHERE plan_id = 'trial';
  INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
  SELECT 'trial', limit_key, limit_value
  FROM subscription_plan_limits
  WHERE plan_id = src_plan;
END $$;
