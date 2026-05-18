-- =====================================================
-- FEATURE REGISTRY SYSTEM MIGRATION
-- Migration: 012_feature_registry_system.sql
-- Date: 2024
-- Description: Create Feature Registry tables and migrate existing features
-- =====================================================

-- 1. Create platform_features table (Feature Registry)
CREATE TABLE IF NOT EXISTS platform_features (
  id VARCHAR(100) PRIMARY KEY,                    -- 'sales_invoices', 'hr_employees'
  category VARCHAR(50) NOT NULL,                  -- 'sales', 'purchase', 'hr', 'reports', 'settings'
  label VARCHAR(100) NOT NULL,                    -- Display name: 'Invoices'
  description TEXT,                               -- Longer description
  icon_name VARCHAR(50),                          -- 'FileText', 'Users', etc. (for UI)
  route_path VARCHAR(200),                        -- Primary route: '/invoices', '/employees'
  is_addon BOOLEAN DEFAULT false,                 -- Addon-based (like WhatsApp) vs plan-based
  is_active BOOLEAN DEFAULT true,                 -- Platform-wide feature flag
  sort_order INTEGER DEFAULT 0,                   -- Display order within category
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create subscription_plan_features mapping table
CREATE TABLE IF NOT EXISTS subscription_plan_features (
  plan_id VARCHAR(50) NOT NULL,
  feature_id VARCHAR(100) NOT NULL,
  enabled BOOLEAN DEFAULT true,
  PRIMARY KEY (plan_id, feature_id),
  FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (feature_id) REFERENCES platform_features(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_plan_features_plan ON subscription_plan_features(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_features_feature ON subscription_plan_features(feature_id);
CREATE INDEX IF NOT EXISTS idx_platform_features_category ON platform_features(category, sort_order);
CREATE INDEX IF NOT EXISTS idx_platform_features_active ON platform_features(is_active, category);

-- =====================================================
-- POPULATE PLATFORM FEATURES
-- =====================================================

-- Insert all platform features with categories and routes
INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon) VALUES
-- SALES CATEGORY
('sales_invoices', 'sales', 'Invoices', 'Create and manage tax invoices', '/invoices', 1, true, false),
('sales_estimates', 'sales', 'Estimates & Quotations', 'Create quotations and convert to invoices', '/estimates', 2, true, false),
('sales_credit_notes', 'sales', 'Credit Notes', 'Handle returns and credit adjustments', '/credit-notes', 3, true, false),
('sales_recurring_invoices', 'sales', 'Recurring Invoices', 'Auto-generate periodic invoices', '/invoices/recurring', 4, true, false),
('sales_sales_orders', 'sales', 'Sales Orders', 'Manage sales orders and delivery challans', '/sales-orders', 5, true, false),

-- PURCHASE CATEGORY
('purchase_management', 'purchase', 'Purchases', 'Track bills and supplier purchases', '/purchases', 1, true, false),
('purchase_suppliers', 'purchase', 'Suppliers', 'Manage suppliers and payables', '/suppliers', 2, true, false),
('purchase_orders', 'purchase', 'Purchase Orders', 'Create and manage purchase orders', '/purchase-orders', 3, true, false),
('purchase_expenses', 'purchase', 'Expense Tracking', 'Record and categorize expenses', '/expenses', 4, true, false),

-- HR & EMPLOYEES CATEGORY (NEW)
('hr_employees', 'hr', 'Employees', 'Employee master & profiles', '/employees', 1, true, false),
('hr_attendance', 'hr', 'Attendance', 'Employee attendance tracking', '/employees/attendance', 2, true, false),
('hr_payroll', 'hr', 'Payroll', 'Salary & payslips management', '/employees/salary', 3, true, false),
('hr_leaves', 'hr', 'Leave Management', 'Manage employee leaves and holidays', '/employees/leaves', 4, true, false),

-- REPORTS CATEGORY
('reports_basic', 'reports', 'Basic Reports', 'Sales, Purchase, and Stock summary reports', '/reports', 1, true, false),
('reports_gst', 'reports', 'GST Reports', 'GSTR-1, GSTR-2, GSTR-3B ready reports', '/reports/gst', 2, true, false),
('reports_advanced', 'reports', 'Advanced Reports', 'P&L, Balance Sheet, Cash Flow, Aging', '/reports/profit-loss', 3, true, false),
('reports_analytics', 'reports', 'Advanced Analytics', 'Profitability, trends, forecasting', '/reports', 4, true, false),

-- SETTINGS CATEGORY
('settings_template_customization', 'settings', 'Template Customization', 'Customize invoice templates', '/settings/templates', 1, true, false),
('settings_multi_user', 'settings', 'Users & Roles', 'Manage team members and permissions', '/settings/users', 2, true, false),
('settings_multi_branch', 'settings', 'Locations & Branches', 'Manage multiple business locations', '/settings/locations', 3, true, false),
('settings_multi_warehouse', 'settings', 'Warehouses', 'Manage multiple warehouses for inventory storage', '/settings/warehouses', 4, true, false),
('settings_backup', 'settings', 'Backup & Restore', 'Download and restore business data', '/settings/backup', 5, true, false),
('settings_whatsapp', 'settings', 'WhatsApp Integration', 'Configure WhatsApp settings', '/settings/whatsapp', 6, true, false),
('settings_pos_mode', 'settings', 'POS Mode', 'Retail billing interface with two-column layout and quick payment entry', '/invoices/new', 7, true, false),

-- INTEGRATIONS CATEGORY
('integration_whatsapp_manual', 'integrations', 'WhatsApp Sending', 'Send invoices manually via WhatsApp', '/whatsapp/send-message', 1, true, true),
('integration_whatsapp_bot', 'integrations', 'WhatsApp Bot', 'Automated WhatsApp conversations and reminders', '/whatsapp/conversations', 2, true, true),
('integration_email', 'integrations', 'Email Invoicing', 'Send invoices via email', null, 3, true, false),
('integration_payment_gateway', 'integrations', 'Payment Gateway', 'Razorpay, PhonePe integration', null, 4, true, false),
('integration_api', 'integrations', 'API Access', 'REST API for custom integrations', null, 5, true, false),

-- ADVANCED CATEGORY
('advanced_ledger', 'advanced', 'Ledger & Accounting', 'Full double-entry bookkeeping', '/ledger', 1, true, false),
('advanced_multi_currency', 'advanced', 'Multi-Currency', 'Support for international invoicing', null, 2, true, false),
('advanced_barcode', 'advanced', 'Barcode Scanning', 'Scan barcodes for quick entry', null, 3, true, false),
('advanced_online_store', 'advanced', 'Online Store', 'Public product catalog with cart', null, 4, true, false),
('advanced_custom_branding', 'advanced', 'Custom Branding', 'Remove "Powered by Khatario"', null, 5, true, false)

ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  route_path = EXCLUDED.route_path,
  icon_name = EXCLUDED.icon_name,
  is_addon = EXCLUDED.is_addon,
  updated_at = CURRENT_TIMESTAMP;

-- =====================================================
-- MIGRATE EXISTING PLAN FEATURES FROM JSONB
-- =====================================================

-- Function to migrate features from JSONB to relational table
DO $$
DECLARE
  plan_record RECORD;
  feature_key_var TEXT;
  feature_value_var TEXT;
  new_feature_id TEXT;
BEGIN
  -- Loop through all plans
  FOR plan_record IN SELECT id, features FROM subscription_plans LOOP
    -- Extract features from JSONB
    IF plan_record.features->'features' IS NOT NULL THEN
      FOR feature_key_var, feature_value_var IN 
        SELECT * FROM jsonb_each_text(plan_record.features->'features')
      LOOP
        -- Map old feature keys to new feature IDs
        CASE feature_key_var
          WHEN 'invoice_creation' THEN new_feature_id := 'sales_invoices';
          WHEN 'customer_management' THEN new_feature_id := NULL; -- Core feature, always enabled
          WHEN 'item_management' THEN new_feature_id := NULL; -- Core feature, always enabled
          WHEN 'payment_tracking' THEN new_feature_id := NULL; -- Core feature, always enabled
          WHEN 'stock_tracking' THEN new_feature_id := NULL; -- Core feature, always enabled
          WHEN 'estimates_quotations' THEN new_feature_id := 'sales_estimates';
          WHEN 'credit_notes' THEN new_feature_id := 'sales_credit_notes';
          WHEN 'recurring_invoices' THEN new_feature_id := 'sales_recurring_invoices';
          WHEN 'purchase_management' THEN new_feature_id := 'purchase_management';
          WHEN 'supplier_management' THEN new_feature_id := 'purchase_suppliers';
          WHEN 'expense_tracking' THEN new_feature_id := 'purchase_expenses';
          WHEN 'template_customization' THEN new_feature_id := 'settings_template_customization';
          WHEN 'multi_user' THEN new_feature_id := 'settings_multi_user';
          WHEN 'multi_branch' THEN new_feature_id := 'settings_multi_branch';
          WHEN 'multi_warehouse' THEN new_feature_id := 'settings_multi_warehouse';
          WHEN 'backup_restore' THEN new_feature_id := 'settings_backup';
          WHEN 'pos_mode' THEN new_feature_id := 'settings_pos_mode';
          WHEN 'whatsapp_manual' THEN new_feature_id := 'integration_whatsapp_manual';
          WHEN 'whatsapp_auto_reminders' THEN new_feature_id := 'integration_whatsapp_bot';
          WHEN 'email_invoicing' THEN new_feature_id := 'integration_email';
          WHEN 'payment_gateway' THEN new_feature_id := 'integration_payment_gateway';
          WHEN 'api_access' THEN new_feature_id := 'integration_api';
          WHEN 'reports_basic' THEN new_feature_id := 'reports_basic';
          WHEN 'reports_gst' THEN new_feature_id := 'reports_gst';
          WHEN 'reports_advanced' THEN new_feature_id := 'reports_advanced';
          WHEN 'reports_analytics' THEN new_feature_id := 'reports_analytics';
          WHEN 'ledger_accounting' THEN new_feature_id := 'advanced_ledger';
          WHEN 'multi_currency' THEN new_feature_id := 'advanced_multi_currency';
          WHEN 'barcode_scanning' THEN new_feature_id := 'advanced_barcode';
          WHEN 'online_store' THEN new_feature_id := 'advanced_online_store';
          WHEN 'custom_branding' THEN new_feature_id := 'advanced_custom_branding';
          ELSE new_feature_id := NULL; -- Skip unmapped features
        END CASE;

        -- Insert if mapping exists and feature exists in platform_features
        IF new_feature_id IS NOT NULL AND 
           EXISTS (SELECT 1 FROM platform_features WHERE platform_features.id = new_feature_id) THEN
          INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
          VALUES (plan_record.id, new_feature_id, (feature_value_var::boolean))
          ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = (feature_value_var::boolean);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- View migration results
-- SELECT 
--   sp.id as plan_id,
--   sp.display_name,
--   COUNT(spf.feature_id) as feature_count,
--   COUNT(CASE WHEN spf.enabled THEN 1 END) as enabled_count
-- FROM subscription_plans sp
-- LEFT JOIN subscription_plan_features spf ON sp.id = spf.plan_id
-- GROUP BY sp.id, sp.display_name
-- ORDER BY sp.sort_order;
