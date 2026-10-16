-- Billing plan ladder.
--   Free (₹0): phone app only, 1 user, no HR.
--   Starter (₹299): Billing on web + phone, counter tools, 3 users, HR Lite bundled.
--   Growth (₹499): + full accounting, 5 users, HR Starter bundled.
--   Business (₹799): + branches, warehouses, online store, e-invoice, 10 users, HR Pro bundled.
-- The ₹399 Growth and ₹999 Business plans stay active for the businesses already on them
-- (renamed "Classic") but are no longer offered (is_public = false).
-- Which HR plan comes with a Billing plan is subscription_plans.bundled_hr_plan_id. To sell HR
-- separately later, create Billing plans without a bundle and make the bundled ones non-public:
-- existing customers keep their plan and its HR.
-- Prices, features and limits below are seed values — edit them in Admin → Plans.

-- 1. Columns ---------------------------------------------------------------------------------
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bundled_hr_plan_id VARCHAR(50);

-- 2. Website access is a plan feature, so Free can be phone-only ------------------------------
INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon)
VALUES ('web_access', 'settings', 'Use on the website',
        'Open Khatario in a browser on a computer. Without it the plan works only in the Khatario phone app.',
        '/dashboard', 0, true, false)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category, label = EXCLUDED.label, description = EXCLUDED.description,
  is_active = true, is_addon = false, updated_at = CURRENT_TIMESTAMP;

UPDATE platform_features
SET pricing_label = 'Use on computer and phone', pricing_rank = 0, show_on_pricing = true, updated_at = CURRENT_TIMESTAMP
WHERE id = 'web_access';

-- Every plan except Free keeps the website (HR-only and Connect-only businesses included).
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT sp.id, 'web_access', true
FROM subscription_plans sp
WHERE sp.id <> 'free'
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;

DELETE FROM subscription_plan_features WHERE plan_id = 'free' AND feature_id = 'web_access';

-- 3. Plans -----------------------------------------------------------------------------------
INSERT INTO subscription_plans
  (id, name, display_name, description, price_monthly, price_yearly, price_3year, currency, features,
   is_active, sort_order, registry_complete, product_line, is_public)
VALUES
  ('billing_starter', 'billing_starter', 'Starter',
   'Billing on computer and phone with POS, barcodes, reminders and 3 users. HR Lite included.',
   299, 2699, 5999, 'INR', '{"limits":{},"features":{}}', true, 2, true, 'billing', true),
  ('billing_growth', 'billing_growth', 'Growth',
   'Everything in Starter plus full accounting and 5 users. HR Starter included.',
   499, 4499, 9999, 'INR', '{"limits":{},"features":{}}', true, 3, true, 'billing', true),
  ('billing_business', 'billing_business', 'Business',
   'Everything in Growth plus branches, warehouses, online store, e-Invoice and 10 users. HR Pro included.',
   799, 7199, 15999, 'INR', '{"limits":{},"features":{}}', true, 4, true, 'billing', true)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  registry_complete = true,
  product_line = EXCLUDED.product_line,
  updated_at = CURRENT_TIMESTAMP;

UPDATE subscription_plans
SET description = 'Free forever in the Khatario phone app: GST bills, quotations, purchases and GST reports for one user.',
    sort_order = 1, is_public = true, updated_at = CURRENT_TIMESTAMP
WHERE id = 'free';

-- Old prices stay for the businesses already on them.
UPDATE subscription_plans SET display_name = 'Growth Classic', is_public = false, sort_order = 30, pricing_badge = NULL,
  updated_at = CURRENT_TIMESTAMP WHERE id = 'growth';
UPDATE subscription_plans SET display_name = 'Business Classic', is_public = false, sort_order = 31,
  updated_at = CURRENT_TIMESTAMP WHERE id = 'business';
UPDATE subscription_plans SET is_public = false, updated_at = CURRENT_TIMESTAMP
WHERE id IN ('professional', 'enterprise', 'trial', 'hr_trial', 'hr_free', 'connect_free');
UPDATE subscription_plans SET description = 'Every Business feature, with HR Pro, free during your trial.', updated_at = CURRENT_TIMESTAMP
WHERE id = 'trial';

UPDATE subscription_plans SET pricing_badge = 'Most popular', updated_at = CURRENT_TIMESTAMP WHERE id = 'billing_growth';

-- 4. HR bundled with each Billing plan (only plans that exist in this database) ---------------
UPDATE subscription_plans sp SET bundled_hr_plan_id = v.hr_plan, updated_at = CURRENT_TIMESTAMP
FROM (VALUES
  ('billing_starter', 'hr_staff_lite'),
  ('billing_growth', 'hr_starter'),
  ('billing_business', 'hr_pro'),
  ('trial', 'hr_pro'),
  ('growth', 'hr_staff_lite'),
  ('business', 'hr_staff_lite'),
  ('professional', 'hr_staff_lite'),
  ('enterprise', 'hr_staff_lite')
) AS v(plan_id, hr_plan)
WHERE sp.id = v.plan_id
  AND EXISTS (SELECT 1 FROM subscription_plans hr WHERE hr.id = v.hr_plan);

UPDATE subscription_plans SET bundled_hr_plan_id = NULL WHERE id = 'free';

-- 5. Feature matrices ------------------------------------------------------------------------
DELETE FROM subscription_plan_features
WHERE plan_id IN ('free', 'billing_starter', 'billing_growth', 'billing_business', 'trial');

CREATE TEMP TABLE plan_ladder_features (plan_id VARCHAR(50), feature_id VARCHAR(100)) ON COMMIT DROP;

-- Free and up
INSERT INTO plan_ladder_features (plan_id, feature_id)
SELECT p.plan_id, f.feature_id
FROM (VALUES ('free'), ('billing_starter'), ('billing_growth'), ('billing_business'), ('trial')) AS p(plan_id)
CROSS JOIN unnest(ARRAY[
  'sales_invoices', 'sales_new_invoice', 'sales_estimates', 'purchase_management',
  'reports_basic', 'reports_gst', 'profit_invoice', 'settings_backup', 'settings_whatsapp',
  'settings_document_language', 'tools_todo', 'advanced_filters', 'bulk_actions',
  'customizable_dashboard', 'mobile_enhancements', 'accessibility', 'dead_stock_widget'
]) AS f(feature_id);

-- Starter and up
INSERT INTO plan_ladder_features (plan_id, feature_id)
SELECT p.plan_id, f.feature_id
FROM (VALUES ('billing_starter'), ('billing_growth'), ('billing_business'), ('trial')) AS p(plan_id)
CROSS JOIN unnest(ARRAY[
  'web_access', 'settings_multi_user', 'settings_pos_mode', 'advanced_barcode',
  'barcode_label_printing', 'barcode_label_from_purchase', 'barcode_label_templates',
  'barcode_thermal_printer', 'barcode_weight_embedded', 'purchase_orders', 'purchase_expenses',
  'purchase_suppliers', 'purchase_inventory_adjustments', 'sales_credit_notes', 'sales_debit_notes',
  'sales_delivery_challans', 'whatsapp_auto_reminders', 'whatsapp_credit_alerts',
  'integration_payment_gateway', 'integration_email', 'email_reminders', 'advanced_custom_branding',
  'settings_template_customization', 'party_pricing', 'eway_bill'
]) AS f(feature_id);

-- Growth and up
INSERT INTO plan_ladder_features (plan_id, feature_id)
SELECT p.plan_id, f.feature_id
FROM (VALUES ('billing_growth'), ('billing_business'), ('trial')) AS p(plan_id)
CROSS JOIN unnest(ARRAY[
  'advanced_ledger', 'accounting_chart', 'accounting_bank', 'accounting_tds', 'accounting_provisions',
  'accounting_credit_approvals', 'accounting_budgets', 'reports_advanced', 'profit_reports_basic',
  'sales_recurring_invoices', 'sales_sales_orders', 'settings_multi_business', 'soft_delete'
]) AS f(feature_id);

-- Business (and Trial)
INSERT INTO plan_ladder_features (plan_id, feature_id)
SELECT p.plan_id, f.feature_id
FROM (VALUES ('billing_business'), ('trial')) AS p(plan_id)
CROSS JOIN unnest(ARRAY[
  'settings_multi_branch', 'settings_multi_warehouse', 'advanced_online_store', 'e_invoice',
  'advanced_multi_currency', 'report_builder', 'sales_work_orders', 'settings_multidevice_login',
  'profit_reports_advanced', 'reports_analytics', 'integration_api', 'workflow_automation'
]) AS f(feature_id);

INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT DISTINCT l.plan_id, l.feature_id, true
FROM plan_ladder_features l
JOIN platform_features pf ON pf.id = l.feature_id
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;

-- 6. Limits (copied from the old Growth / Business, then adjusted) ----------------------------
INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
SELECT n.plan_id, l.limit_key, l.limit_value
FROM (VALUES ('billing_starter', 'growth'), ('billing_growth', 'growth'), ('billing_business', 'business')) AS n(plan_id, source)
JOIN subscription_plan_limits l ON l.plan_id = n.source
ON CONFLICT (plan_id, limit_key) DO NOTHING;

INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
SELECT v.plan_id, v.limit_key, v.limit_value
FROM (VALUES
  ('billing_starter', 'max_users', 3),
  ('billing_starter', 'max_branches', 1),
  ('billing_starter', 'max_eway_bills_per_month', 10),
  ('billing_growth', 'max_users', 5),
  ('billing_growth', 'max_branches', 1),
  ('billing_growth', 'max_whatsapp_per_day', 300),
  ('billing_growth', 'max_email_per_day', 200),
  ('billing_growth', 'max_eway_bills_per_month', 25),
  ('billing_business', 'max_users', 10),
  ('billing_business', 'max_branches', 3),
  ('billing_business', 'max_eway_bills_per_month', -1)
) AS v(plan_id, limit_key, limit_value)
JOIN platform_limits pl ON pl.limit_key = v.limit_key
ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = EXCLUDED.limit_value, updated_at = CURRENT_TIMESTAMP;
