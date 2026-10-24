-- Backfill billing plan limit rows. Where seed_subscriptions.sql ran after 013, only Free got rows,
-- so paid plans fell back to platform_limits defaults (10 items, 1 user, ...).
-- DO NOTHING on conflict: values already set in the admin panel are kept.

INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
SELECT v.plan_id, v.limit_key, v.limit_value
FROM (VALUES
  ('professional', 'max_items', -1),
  ('professional', 'max_customers', -1),
  ('professional', 'max_invoices_per_month', 500),
  ('professional', 'max_users', 3),
  ('professional', 'max_suppliers', -1),
  ('professional', 'max_purchases_per_month', -1),
  ('professional', 'max_expenses_per_month', -1),
  ('professional', 'max_purchase_orders_per_month', -1),
  ('professional', 'max_estimates_per_month', -1),
  ('professional', 'max_credit_notes_per_month', -1),
  ('professional', 'max_sales_orders_per_month', -1),
  ('professional', 'max_branches', 1),
  ('professional', 'max_email_per_day', 10),

  ('business', 'max_items', -1),
  ('business', 'max_customers', -1),
  ('business', 'max_invoices_per_month', -1),
  ('business', 'max_users', 10),
  ('business', 'max_suppliers', -1),
  ('business', 'max_purchases_per_month', -1),
  ('business', 'max_expenses_per_month', -1),
  ('business', 'max_purchase_orders_per_month', -1),
  ('business', 'max_estimates_per_month', -1),
  ('business', 'max_credit_notes_per_month', -1),
  ('business', 'max_sales_orders_per_month', -1),
  ('business', 'max_branches', 3),
  ('business', 'max_email_per_day', 200),

  ('enterprise', 'max_items', -1),
  ('enterprise', 'max_customers', -1),
  ('enterprise', 'max_invoices_per_month', -1),
  ('enterprise', 'max_users', -1),
  ('enterprise', 'max_suppliers', -1),
  ('enterprise', 'max_purchases_per_month', -1),
  ('enterprise', 'max_expenses_per_month', -1),
  ('enterprise', 'max_purchase_orders_per_month', -1),
  ('enterprise', 'max_estimates_per_month', -1),
  ('enterprise', 'max_credit_notes_per_month', -1),
  ('enterprise', 'max_sales_orders_per_month', -1),
  ('enterprise', 'max_branches', -1),
  ('enterprise', 'max_email_per_day', -1)
) AS v(plan_id, limit_key, limit_value)
WHERE EXISTS (SELECT 1 FROM subscription_plans sp WHERE sp.id = v.plan_id)
  AND EXISTS (SELECT 1 FROM platform_limits pl WHERE pl.limit_key = v.limit_key)
ON CONFLICT (plan_id, limit_key) DO NOTHING;

-- Trial mirrors Enterprise (same rule as 154/284).
INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
SELECT 'trial', spl.limit_key, spl.limit_value
FROM subscription_plan_limits spl
WHERE spl.plan_id = 'enterprise'
  AND EXISTS (SELECT 1 FROM subscription_plans WHERE id = 'trial')
ON CONFLICT (plan_id, limit_key) DO NOTHING;
