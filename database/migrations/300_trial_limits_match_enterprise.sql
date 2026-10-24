-- The signup trial promises full access, so its limits mirror Enterprise (154/284/297).
-- 154 cloned Enterprise before 297 backfilled it, leaving trial with Free-like caps
-- (10 items, 10 customers, 50 invoices/month); 297 used DO NOTHING and never corrected them.
-- Overwrite every trial limit that Enterprise defines. HR-only keys (no Enterprise row) are untouched.

INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
SELECT 'trial', spl.limit_key, spl.limit_value
FROM subscription_plan_limits spl
WHERE spl.plan_id = 'enterprise'
  AND EXISTS (SELECT 1 FROM subscription_plans WHERE id = 'trial')
ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = EXCLUDED.limit_value;
