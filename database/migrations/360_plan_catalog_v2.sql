-- Migration 360: plan catalog v2.
-- Billing: Free / Growth / Business (+ signup Trial with Business features).
-- Connect: paid add-on plan `connect`; `connect_free` is the lapsed / not-bought state.
-- Basic WhatsApp (QR link, invoice sends, manual reminders) belongs to every billing plan;
-- automatic reminders start at Growth; inbox, AI, WABA, templates and shop need Connect.
-- Prices and limits below are seed values — edit them later in Admin → Plans.
-- Existing customers move to the new plans now (paid periods kept); paid WhatsApp add-ons
-- become Connect subscriptions.

-- 1. 3-year pricing --------------------------------------------------------------------------
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS price_3year DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE billing_transactions DROP CONSTRAINT IF EXISTS billing_transactions_billing_cycle_check;
ALTER TABLE billing_transactions
  ADD CONSTRAINT billing_transactions_billing_cycle_check
  CHECK (billing_cycle IN ('monthly', 'yearly', 'three_year'));

-- 2. New features and limits -----------------------------------------------------------------
INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon) VALUES
  ('whatsapp_auto_reminders', 'integrations', 'WhatsApp auto reminders',
   'Payment reminders sent automatically before and after the due date', '/settings/whatsapp/notifications', 6, true, false),
  ('e_invoice', 'sales', 'e-Invoice (IRN)', 'Generate IRN and signed QR for B2B invoices', NULL, 20, true, false),
  ('eway_bill', 'sales', 'e-Way bills', 'Generate e-way bills for goods movement', NULL, 21, true, false)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active = true,
  is_addon = false,
  updated_at = CURRENT_TIMESTAMP;

UPDATE platform_features
SET is_addon = false,
    label = 'Connect: inbox, bot & AI',
    description = 'Shared WhatsApp inbox, bot rules, AI agent, campaigns and WhatsApp shop',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'integration_whatsapp_bot';

UPDATE platform_features
SET is_addon = false,
    label = 'Connect: custom & bulk messages',
    description = 'Free-form and bulk WhatsApp messages beyond invoices and reminders',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'integration_whatsapp_manual';

INSERT INTO platform_limits (limit_key, category, label, description, unit, default_value, sort_order) VALUES
  ('max_ai_replies_per_month', 'integrations', 'AI replies per month',
   'Replies the AI agent may send on Khatario''s AI key each month', 'per month', 0, 3),
  ('max_eway_bills_per_month', 'sales', 'e-Way bills per month',
   'Maximum e-way bills generated per month', 'per month', 0, 7)
ON CONFLICT (limit_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  unit = EXCLUDED.unit,
  is_active = true,
  updated_at = CURRENT_TIMESTAMP;

-- 3. Plans -----------------------------------------------------------------------------------
INSERT INTO subscription_plans
  (id, name, display_name, description, price_monthly, price_yearly, price_3year, currency, features,
   is_active, sort_order, registry_complete, product_line)
VALUES
  ('free', 'free', 'Free', 'Unlimited GST invoices for one user, with WhatsApp invoice sending from your own number.',
   0, 0, 0, 'INR', '{"limits":{},"features":{}}', true, 1, true, 'billing'),
  ('growth', 'growth', 'Growth', 'For shops and traders: automatic WhatsApp payment reminders, inventory, POS and 3 users.',
   399, 3588, 7999, 'INR', '{"limits":{},"features":{}}', true, 2, true, 'billing'),
  ('business', 'business', 'Business', 'Full accounting, multiple branches and warehouses, online store and 10 users.',
   999, 9588, 21999, 'INR', '{"limits":{},"features":{}}', true, 3, true, 'billing'),
  ('trial', 'trial', 'Trial', 'Every Business feature free during your trial.',
   0, 0, 0, 'INR', '{"limits":{},"features":{}}', true, 5, true, 'billing'),
  ('connect', 'connect', 'Connect', 'Official WhatsApp Business API, shared inbox, AI agent, templates, campaigns and WhatsApp shop.',
   1499, 14388, 34999, 'INR', '{"limits":{},"features":{}}', true, 20, true, 'connect'),
  ('connect_free', 'connect_free', 'Connect (not active)', 'Connect is not active. Buy Connect to use the inbox, AI agent and automation.',
   0, 0, 0, 'INR', '{"limits":{},"features":{}}', true, 21, true, 'connect')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  price_3year = EXCLUDED.price_3year,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  registry_complete = true,
  product_line = EXCLUDED.product_line,
  updated_at = CURRENT_TIMESTAMP;

-- 4. Feature matrices ------------------------------------------------------------------------
DELETE FROM subscription_plan_features
WHERE plan_id IN ('free', 'growth', 'business', 'trial', 'connect', 'connect_free');

CREATE TEMP TABLE plan_v2_features (plan_id VARCHAR(50), feature_id VARCHAR(100)) ON COMMIT DROP;

INSERT INTO plan_v2_features (plan_id, feature_id)
SELECT p.plan_id, f.feature_id
FROM (VALUES ('free'), ('growth'), ('business'), ('trial')) AS p(plan_id)
CROSS JOIN unnest(ARRAY[
  'sales_invoices', 'sales_new_invoice', 'sales_estimates', 'purchase_management',
  'reports_basic', 'reports_gst', 'profit_invoice', 'settings_backup', 'settings_whatsapp',
  'tools_todo', 'advanced_filters', 'bulk_actions', 'customizable_dashboard',
  'mobile_enhancements', 'accessibility', 'dead_stock_widget'
]) AS f(feature_id);

INSERT INTO plan_v2_features (plan_id, feature_id)
SELECT p.plan_id, f.feature_id
FROM (VALUES ('growth'), ('business'), ('trial')) AS p(plan_id)
CROSS JOIN unnest(ARRAY[
  'sales_credit_notes', 'sales_debit_notes', 'sales_sales_orders', 'sales_delivery_challans',
  'sales_recurring_invoices', 'purchase_suppliers', 'purchase_expenses', 'purchase_orders',
  'purchase_inventory_adjustments', 'settings_multi_user', 'settings_template_customization',
  'settings_pos_mode', 'advanced_barcode', 'barcode_label_printing', 'barcode_label_from_purchase',
  'barcode_label_templates', 'barcode_thermal_printer', 'barcode_weight_embedded',
  'advanced_custom_branding', 'integration_payment_gateway', 'integration_email', 'email_reminders',
  'whatsapp_auto_reminders', 'whatsapp_credit_alerts', 'party_pricing', 'profit_reports_basic',
  'reports_advanced', 'soft_delete', 'eway_bill'
]) AS f(feature_id);

INSERT INTO plan_v2_features (plan_id, feature_id)
SELECT p.plan_id, f.feature_id
FROM (VALUES ('business'), ('trial')) AS p(plan_id)
CROSS JOIN unnest(ARRAY[
  'advanced_ledger', 'settings_multi_branch', 'settings_multi_warehouse', 'sales_work_orders',
  'advanced_online_store', 'advanced_multi_currency', 'integration_api', 'reports_analytics',
  'profit_reports_advanced', 'report_builder', 'workflow_automation', 'settings_multidevice_login',
  'e_invoice'
]) AS f(feature_id);

INSERT INTO plan_v2_features (plan_id, feature_id) VALUES
  ('connect', 'settings_whatsapp'),
  ('connect', 'settings_multi_user'),
  ('connect', 'whatsapp_auto_reminders'),
  ('connect', 'integration_whatsapp_bot'),
  ('connect', 'integration_whatsapp_manual'),
  ('connect_free', 'settings_whatsapp'),
  ('connect_free', 'settings_multi_user');

INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT DISTINCT v.plan_id, v.feature_id, true
FROM plan_v2_features v
JOIN platform_features pf ON pf.id = v.feature_id
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;

-- 5. Limits (-1 = unlimited) -----------------------------------------------------------------
DELETE FROM subscription_plan_limits
WHERE plan_id IN ('free', 'growth', 'business', 'trial', 'connect', 'connect_free');

INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
SELECT v.plan_id, v.limit_key, v.limit_value
FROM (VALUES
  ('free', 'max_invoices_per_month', -1), ('free', 'max_customers', -1), ('free', 'max_items', -1),
  ('free', 'max_estimates_per_month', -1), ('free', 'max_credit_notes_per_month', 0),
  ('free', 'max_sales_orders_per_month', 0), ('free', 'max_purchases_per_month', -1),
  ('free', 'max_suppliers', -1), ('free', 'max_purchase_orders_per_month', 0),
  ('free', 'max_expenses_per_month', -1), ('free', 'max_users', 1), ('free', 'max_branches', 1),
  ('free', 'max_departments', 5), ('free', 'max_whatsapp_per_day', 20), ('free', 'max_email_per_day', 10),
  ('free', 'max_eway_bills_per_month', 0),

  ('growth', 'max_invoices_per_month', -1), ('growth', 'max_customers', -1), ('growth', 'max_items', -1),
  ('growth', 'max_estimates_per_month', -1), ('growth', 'max_credit_notes_per_month', -1),
  ('growth', 'max_sales_orders_per_month', -1), ('growth', 'max_purchases_per_month', -1),
  ('growth', 'max_suppliers', -1), ('growth', 'max_purchase_orders_per_month', -1),
  ('growth', 'max_expenses_per_month', -1), ('growth', 'max_users', 3), ('growth', 'max_branches', 1),
  ('growth', 'max_departments', 10), ('growth', 'max_whatsapp_per_day', 200), ('growth', 'max_email_per_day', 100),
  ('growth', 'max_eway_bills_per_month', 10),

  ('business', 'max_invoices_per_month', -1), ('business', 'max_customers', -1), ('business', 'max_items', -1),
  ('business', 'max_estimates_per_month', -1), ('business', 'max_credit_notes_per_month', -1),
  ('business', 'max_sales_orders_per_month', -1), ('business', 'max_purchases_per_month', -1),
  ('business', 'max_suppliers', -1), ('business', 'max_purchase_orders_per_month', -1),
  ('business', 'max_expenses_per_month', -1), ('business', 'max_users', 10), ('business', 'max_branches', 3),
  ('business', 'max_departments', -1), ('business', 'max_whatsapp_per_day', 500), ('business', 'max_email_per_day', 500),
  ('business', 'max_eway_bills_per_month', -1),

  ('trial', 'max_invoices_per_month', -1), ('trial', 'max_customers', -1), ('trial', 'max_items', -1),
  ('trial', 'max_estimates_per_month', -1), ('trial', 'max_credit_notes_per_month', -1),
  ('trial', 'max_sales_orders_per_month', -1), ('trial', 'max_purchases_per_month', -1),
  ('trial', 'max_suppliers', -1), ('trial', 'max_purchase_orders_per_month', -1),
  ('trial', 'max_expenses_per_month', -1), ('trial', 'max_users', 10), ('trial', 'max_branches', 3),
  ('trial', 'max_departments', -1), ('trial', 'max_whatsapp_per_day', 200), ('trial', 'max_email_per_day', 500),
  ('trial', 'max_eway_bills_per_month', -1),

  ('connect', 'max_users', 5), ('connect', 'max_whatsapp_per_day', 1000),
  ('connect', 'max_ai_replies_per_month', 500),
  ('connect_free', 'max_users', 1), ('connect_free', 'max_whatsapp_per_day', 20),
  ('connect_free', 'max_ai_replies_per_month', 0)
) AS v(plan_id, limit_key, limit_value)
JOIN platform_limits pl ON pl.limit_key = v.limit_key;

-- 6. Move existing billing customers to the new plans (paid periods unchanged) ---------------
UPDATE business_module_subscriptions
SET plan_id = CASE plan_id WHEN 'professional' THEN 'growth' WHEN 'enterprise' THEN 'business' END,
    updated_at = CURRENT_TIMESTAMP
WHERE module_key = 'billing' AND plan_id IN ('professional', 'enterprise');

UPDATE business_module_subscriptions
SET scheduled_plan_id = CASE scheduled_plan_id WHEN 'professional' THEN 'growth' WHEN 'enterprise' THEN 'business' END,
    updated_at = CURRENT_TIMESTAMP
WHERE scheduled_plan_id IN ('professional', 'enterprise');

UPDATE subscription_plans
SET is_active = false, updated_at = CURRENT_TIMESTAMP
WHERE id IN ('professional', 'enterprise');

UPDATE platform_promotions
SET target_audience = CASE target_audience WHEN 'professional' THEN 'growth' WHEN 'enterprise' THEN 'business' END
WHERE target_audience IN ('professional', 'enterprise');

-- 7. Paid WhatsApp add-ons become Connect --------------------------------------------------
-- Add-ons were activated without an end date, so the converted Connect period runs one month
-- from today unless the add-on carried its own end date.
CREATE TEMP TABLE connect_from_addons ON COMMIT DROP AS
SELECT business_id,
       CASE WHEN bool_or(end_date IS NULL) THEN NULL ELSE MAX(end_date) END AS addon_end
FROM whatsapp_addons
WHERE addon_type IN ('whatsapp_bot', 'whatsapp_send_message', 'khatario_ai')
  AND status = 'active'
  AND (end_date IS NULL OR end_date >= CURRENT_DATE)
GROUP BY business_id;

INSERT INTO business_module_subscriptions
  (business_id, module_key, plan_id, status, start_date, end_date, billing_cycle)
SELECT c.business_id, 'connect', 'connect', 'active', CURRENT_DATE,
       COALESCE(c.addon_end, (CURRENT_DATE + INTERVAL '1 month')::date), 'monthly'
FROM connect_from_addons c
ON CONFLICT (business_id, module_key) DO UPDATE SET
  plan_id = 'connect',
  status = 'active',
  start_date = CURRENT_DATE,
  end_date = EXCLUDED.end_date,
  trial_end_date = NULL,
  grace_period_end = NULL,
  scheduled_plan_id = NULL,
  cancel_at_period_end = false,
  billing_cycle = 'monthly',
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO business_modules (business_id, module_key, enabled, source)
SELECT business_id, 'connect', true, 'addon_to_connect_360'
FROM connect_from_addons
ON CONFLICT (business_id, module_key) DO UPDATE SET enabled = true;

UPDATE whatsapp_addons
SET status = 'migrated', updated_at = CURRENT_TIMESTAMP
WHERE addon_type IN ('whatsapp_bot', 'whatsapp_send_message', 'khatario_ai')
  AND status = 'active'
  AND business_id IN (SELECT business_id FROM connect_from_addons);

-- Connect rows from the old free Connect plan that did not pay for anything.
UPDATE business_module_subscriptions
SET plan_id = 'connect_free',
    status = 'active',
    end_date = NULL,
    trial_end_date = NULL,
    grace_period_end = NULL,
    scheduled_plan_id = NULL,
    cancel_at_period_end = false,
    updated_at = CURRENT_TIMESTAMP
WHERE module_key = 'connect'
  AND plan_id = 'connect'
  AND business_id NOT IN (SELECT business_id FROM connect_from_addons);

COMMENT ON COLUMN subscription_plans.price_3year IS 'Price for a 3-year prepaid term (0 = not offered).';
COMMENT ON COLUMN whatsapp_addons.status IS 'active, expired, cancelled, or migrated (converted to a Connect subscription in 360)';
