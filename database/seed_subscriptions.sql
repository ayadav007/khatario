-- Seed Subscription Plans
-- Run this after schema.sql is applied

-- First, insert feature flags (master list)
INSERT INTO feature_flags (id, name, description, category, is_active) VALUES
-- Limits
('limit_invoices', 'Invoice Limit', 'Maximum invoices per month', 'limits', true),
('limit_customers', 'Customer Limit', 'Maximum number of customers', 'limits', true),
('limit_items', 'Item Limit', 'Maximum number of items', 'limits', true),
('limit_users', 'User Limit', 'Maximum number of users/staff', 'limits', true),
('limit_whatsapp_daily', 'WhatsApp Daily Limit', 'Maximum WhatsApp messages per day', 'limits', true),

-- Core Features
('dashboard_analytics', 'Dashboard Analytics', 'Full dashboard with KPIs and insights', 'core', true),
('customer_management', 'Customer Management', 'Basic customer CRUD operations', 'core', true),
('item_management', 'Item Management', 'Basic item/product catalog', 'core', true),
('invoice_creation', 'Invoice Creation', 'Create and manage invoices', 'core', true),
('payment_tracking', 'Payment Tracking', 'Record payments against invoices', 'core', true),
('stock_tracking', 'Stock Tracking', 'Basic inventory tracking', 'core', true),

-- Invoice Templates
('template_basic', 'Basic Templates', 'GST Standard and Classic templates', 'invoicing', true),
('template_all', 'All Templates', 'Access to all 7 invoice templates', 'invoicing', true),
('template_thermal', 'Thermal Printing', '58mm and 80mm thermal printer templates', 'invoicing', true),
('template_customization', 'Template Customization', 'Customize colors, fonts, margins, field visibility', 'invoicing', true),
('pdf_generation', 'PDF Generation', 'Download invoices as PDF', 'invoicing', true),

-- Modules
('purchase_management', 'Purchase Management', 'Track bills and supplier purchases', 'modules', true),
('expense_tracking', 'Expense Tracking', 'Record and categorize expenses', 'modules', true),
('supplier_management', 'Supplier Management', 'Manage suppliers and payables', 'modules', true),
('multi_user', 'Multi-user Access', 'Allow multiple users with role-based permissions', 'modules', true),
('multi_branch', 'Multi-branch Support', 'Manage multiple business locations', 'modules', true),

-- Reports
('reports_basic', 'Basic Reports', 'Sales, Purchase, and Stock summary reports', 'reports', true),
('reports_gst', 'GST Reports', 'GSTR-1, GSTR-2, GSTR-3B ready reports', 'reports', true),
('reports_advanced', 'Advanced Reports', 'P&L, Customer Aging, Stock Valuation', 'reports', true),
('reports_analytics', 'Advanced Analytics', 'Profitability, trends, forecasting', 'reports', true),

-- Alerts & Automation
('alert_low_stock', 'Low Stock Alerts', 'Get notified when stock runs low', 'alerts', true),
('alert_credit_limit', 'Credit Limit Monitoring', 'Alerts when customer exceeds credit limit', 'alerts', true),
('recurring_invoices', 'Recurring Invoices', 'Auto-generate periodic invoices', 'automation', true),

-- Integrations
('whatsapp_manual', 'WhatsApp Sending', 'Send invoices manually via WhatsApp', 'integrations', true),
('whatsapp_auto_reminders', 'WhatsApp Auto Reminders', 'Automated payment reminders', 'integrations', true),
('email_invoicing', 'Email Invoicing', 'Send invoices via email', 'integrations', true),
('payment_gateway', 'Payment Gateway', 'Razorpay, PhonePe, Paytm integration', 'integrations', true),
('api_access', 'API Access', 'REST API for custom integrations', 'integrations', true),

-- Advanced Features
('estimates_quotations', 'Estimates & Quotations', 'Create quotes and convert to invoices', 'advanced', true),
('credit_notes', 'Credit Notes & Returns', 'Handle returns and adjustments', 'advanced', true),
('ledger_accounting', 'Ledger & Accounting', 'Full double-entry bookkeeping', 'advanced', true),
('backup_restore', 'Backup & Restore', 'Daily auto-backup to cloud', 'advanced', true),
('online_store', 'Online Store', 'Public product catalog with cart', 'advanced', true),
('barcode_scanning', 'Barcode Scanning', 'Scan barcodes for quick entry', 'advanced', true),
('multi_currency', 'Multi-currency', 'Support for international invoicing', 'advanced', true),
('custom_branding', 'Custom Branding', 'Remove "Powered by Khatario"', 'advanced', true)

ON CONFLICT (id) DO NOTHING;

-- Insert subscription plans
INSERT INTO subscription_plans (id, name, display_name, description, price_monthly, price_yearly, currency, features, is_active, sort_order) VALUES

-- FREE PLAN
('free', 'free', 'Free / Starter', 'Perfect for solo freelancers and trying out the platform', 0, 0, 'INR', 
'{
  "limits": {
    "max_invoices_per_month": 20,
    "max_customers": 10,
    "max_items": 10,
    "max_users": 1,
    "max_whatsapp_per_day": 0
  },
  "features": {
    "customer_management": true,
    "item_management": true,
    "invoice_creation": true,
    "payment_tracking": true,
    "stock_tracking": true,
    "template_basic": true,
    "pdf_generation": true,
    "dashboard_analytics": false,
    "template_all": false,
    "template_thermal": false,
    "template_customization": false,
    "purchase_management": false,
    "expense_tracking": false,
    "supplier_management": false,
    "multi_user": false,
    "reports_basic": false,
    "reports_gst": false,
    "alert_low_stock": false,
    "alert_credit_limit": false,
    "whatsapp_manual": false,
    "whatsapp_auto_reminders": false,
    "email_invoicing": false,
    "recurring_invoices": false,
    "estimates_quotations": false,
    "credit_notes": false,
    "ledger_accounting": false,
    "backup_restore": false
  }
}'::jsonb, true, 1),

-- PROFESSIONAL PLAN
('professional', 'professional', 'Professional', 'Growing businesses and retail shops', 299, 2999, 'INR',
'{
  "limits": {
    "max_invoices_per_month": 500,
    "max_customers": -1,
    "max_items": -1,
    "max_users": 3,
    "max_whatsapp_per_day": 10
  },
  "features": {
    "customer_management": true,
    "item_management": true,
    "invoice_creation": true,
    "payment_tracking": true,
    "stock_tracking": true,
    "dashboard_analytics": true,
    "template_basic": true,
    "template_all": true,
    "template_thermal": true,
    "template_customization": true,
    "pdf_generation": true,
    "purchase_management": true,
    "expense_tracking": true,
    "supplier_management": true,
    "multi_user": true,
    "reports_basic": true,
    "alert_low_stock": true,
    "alert_credit_limit": true,
    "whatsapp_manual": true,
    "email_invoicing": false,
    "reports_gst": false,
    "whatsapp_auto_reminders": false,
    "recurring_invoices": false,
    "estimates_quotations": false,
    "credit_notes": false,
    "ledger_accounting": false,
    "backup_restore": false,
    "multi_branch": false
  }
}'::jsonb, true, 2),

-- BUSINESS PLAN
('business', 'business', 'Business', 'Established businesses with advanced needs', 999, 9999, 'INR',
'{
  "limits": {
    "max_invoices_per_month": -1,
    "max_customers": -1,
    "max_items": -1,
    "max_users": 10,
    "max_whatsapp_per_day": 100
  },
  "features": {
    "customer_management": true,
    "item_management": true,
    "invoice_creation": true,
    "payment_tracking": true,
    "stock_tracking": true,
    "dashboard_analytics": true,
    "template_basic": true,
    "template_all": true,
    "template_thermal": true,
    "template_customization": true,
    "pdf_generation": true,
    "purchase_management": true,
    "expense_tracking": true,
    "supplier_management": true,
    "multi_user": true,
    "reports_basic": true,
    "reports_gst": true,
    "reports_advanced": true,
    "alert_low_stock": true,
    "alert_credit_limit": true,
    "whatsapp_manual": true,
    "whatsapp_auto_reminders": true,
    "email_invoicing": true,
    "recurring_invoices": true,
    "estimates_quotations": true,
    "credit_notes": true,
    "ledger_accounting": true,
    "backup_restore": true,
    "multi_branch": true,
    "reports_analytics": false,
    "payment_gateway": false,
    "api_access": false,
    "online_store": false,
    "barcode_scanning": false,
    "multi_currency": false,
    "custom_branding": false
  }
}'::jsonb, true, 3),

-- ENTERPRISE PLAN
('enterprise', 'enterprise', 'Enterprise', 'Large businesses with custom requirements', 2999, 29999, 'INR',
'{
  "limits": {
    "max_invoices_per_month": -1,
    "max_customers": -1,
    "max_items": -1,
    "max_users": -1,
    "max_whatsapp_per_day": -1
  },
  "features": {
    "customer_management": true,
    "item_management": true,
    "invoice_creation": true,
    "payment_tracking": true,
    "stock_tracking": true,
    "dashboard_analytics": true,
    "template_basic": true,
    "template_all": true,
    "template_thermal": true,
    "template_customization": true,
    "pdf_generation": true,
    "purchase_management": true,
    "expense_tracking": true,
    "supplier_management": true,
    "multi_user": true,
    "reports_basic": true,
    "reports_gst": true,
    "reports_advanced": true,
    "reports_analytics": true,
    "alert_low_stock": true,
    "alert_credit_limit": true,
    "whatsapp_manual": true,
    "whatsapp_auto_reminders": true,
    "email_invoicing": true,
    "payment_gateway": true,
    "api_access": true,
    "recurring_invoices": true,
    "estimates_quotations": true,
    "credit_notes": true,
    "ledger_accounting": true,
    "backup_restore": true,
    "multi_branch": true,
    "online_store": true,
    "barcode_scanning": true,
    "multi_currency": true,
    "custom_branding": true
  }
}'::jsonb, true, 4)

ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order;

-- Trial plan (Plan A): clone enterprise matrix for new signups; registry rows via migration 154 if needed
INSERT INTO subscription_plans (id, name, display_name, description, price_monthly, price_yearly, currency, features, is_active, sort_order)
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
  5
FROM subscription_plans
WHERE id = 'enterprise'
LIMIT 1
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order;

-- Assign free plan to all existing businesses (if any)
INSERT INTO business_subscriptions (business_id, plan_id, status, start_date, trial_end_date)
SELECT 
  id,
  'free',
  'active',
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '30 days'
FROM businesses
WHERE NOT EXISTS (
  SELECT 1 FROM business_subscriptions WHERE business_subscriptions.business_id = businesses.id
);

COMMIT;

