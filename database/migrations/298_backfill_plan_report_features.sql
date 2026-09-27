-- 284 maps legacy JSONB feature keys through a fixed CASE list that omits reports_*, whose
-- registry ids are identical to the JSONB keys. Plans that declare them lost GST/advanced reports.
-- DO NOTHING on conflict: entitlements already set in the admin panel are kept.

INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT sp.id, f.key, true
FROM subscription_plans sp
CROSS JOIN LATERAL jsonb_each_text(sp.features->'features') AS f(key, val)
WHERE sp.is_active = true
  AND COALESCE(sp.product_line, 'billing') = 'billing'
  AND f.val = 'true'
  AND f.key IN ('reports_basic', 'reports_gst', 'reports_advanced', 'reports_analytics')
  AND EXISTS (SELECT 1 FROM platform_features pf WHERE pf.id = f.key)
ON CONFLICT (plan_id, feature_id) DO NOTHING;
