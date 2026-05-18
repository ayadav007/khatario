-- Ensure Free / Starter has explicit rows for commonly used limits (admin UI defaults otherwise).

INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
SELECT 'free', pl.limit_key, pl.default_value
FROM platform_limits pl
WHERE pl.is_active = true
  AND pl.limit_key IN (
    'max_estimates_per_month',
    'max_credit_notes_per_month',
    'max_sales_orders_per_month',
    'max_purchase_orders_per_month',
    'max_expenses_per_month',
    'max_branches',
    'max_departments',
    'max_email_per_day'
  )
ON CONFLICT (plan_id, limit_key) DO NOTHING;
