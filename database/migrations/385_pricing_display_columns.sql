-- How plans read on the public pricing section.
-- Which features a plan has still comes only from subscription_plan_features;
-- these columns decide the wording, the order, and which rows are left off the page.
-- Edit them in Admin → Plans → Pricing page.

ALTER TABLE platform_features
  ADD COLUMN IF NOT EXISTS show_on_pricing BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pricing_label VARCHAR(120),
  ADD COLUMN IF NOT EXISTS pricing_rank INTEGER NOT NULL DEFAULT 100;

ALTER TABLE platform_limits
  ADD COLUMN IF NOT EXISTS show_on_pricing BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pricing_label_one VARCHAR(80),
  ADD COLUMN IF NOT EXISTS pricing_label_many VARCHAR(80),
  ADD COLUMN IF NOT EXISTS pricing_rank INTEGER NOT NULL DEFAULT 100;

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS pricing_badge VARCHAR(40);

-- Rows with nothing behind them, or not worth selling (docs/audits/FEATURE_MATRIX_AUDIT.md §1–2).
UPDATE platform_features SET show_on_pricing = false, updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  'sales_new_invoice', 'reports_analytics', 'profit_reports_advanced', 'barcode_weight_embedded',
  'integration_api', 'workflow_automation', 'accessibility', 'mobile_enhancements'
);

-- Customer-facing wording and order. Lower rank shows first on a plan card.
UPDATE platform_features pf
SET pricing_label = v.label, pricing_rank = v.rank, updated_at = CURRENT_TIMESTAMP
FROM (VALUES
  ('sales_invoices', 'GST invoices & bills of supply', 1),
  ('reports_gst', 'GSTR-1, 3B & 2B reports', 2),
  ('settings_whatsapp', 'WhatsApp bills from your own number', 2),
  ('whatsapp_auto_reminders', 'Automatic WhatsApp payment reminders', 1),
  ('settings_pos_mode', 'POS billing screen', 3),
  ('purchase_management', 'Purchase bills', 3),
  ('advanced_ledger', 'Full accounting ledger', 4),
  ('settings_document_language', 'Print in 13 Indian languages', 4),
  ('sales_estimates', 'Quotations & estimates', 5),
  ('settings_multi_branch', 'Multiple branches', 5),
  ('reports_basic', 'Sales, purchase & stock reports', 6),
  ('settings_multi_warehouse', 'Multiple warehouses', 7),
  ('integration_payment_gateway', 'Online payment links (UPI & cards)', 7),
  ('advanced_online_store', 'Online store', 8),
  ('reports_advanced', 'P&L, balance sheet & cash flow', 9),
  ('advanced_barcode', 'Barcode scanning at the counter', 10),
  ('barcode_label_printing', 'Barcode label printing', 11),
  ('e_invoice', 'e-Invoice (IRN)', 12),
  ('advanced_custom_branding', 'Your logo & brand on invoices', 13),
  ('eway_bill', 'e-Way bills', 14),
  ('accounting_bank', 'Bank import & reconciliation', 15),
  ('purchase_expenses', 'Expense tracking', 16),
  ('settings_template_customization', 'Custom invoice templates', 17),
  ('profit_invoice', 'Profit on every invoice', 18),
  ('report_builder', 'Custom report builder', 19),
  ('sales_credit_notes', 'Credit notes for returns', 20),
  ('profit_reports_basic', 'Profit reports', 21),
  ('purchase_suppliers', 'Supplier ledger', 22),
  ('integration_email', 'Email invoices', 23),
  ('purchase_orders', 'Purchase orders', 24),
  ('sales_delivery_challans', 'Delivery challans', 25),
  ('whatsapp_credit_alerts', 'WhatsApp credit-limit alerts', 26),
  ('accounting_tds', 'TDS / TCS', 27),
  ('party_pricing', 'Customer-specific prices', 28),
  ('email_reminders', 'Email payment reminders', 29),
  ('sales_recurring_invoices', 'Recurring invoices', 30),
  ('settings_multi_user', 'Team users & roles', 31),
  ('purchase_inventory_adjustments', 'Stock adjustments', 32),
  ('settings_multi_business', 'More than one business on one login', 33),
  ('advanced_multi_currency', 'Multi-currency invoices', 34),
  ('sales_sales_orders', 'Sales orders', 35),
  ('settings_multidevice_login', 'Use on several devices at once', 36),
  ('soft_delete', 'Recycle bin for deleted bills', 37),
  ('dead_stock_widget', 'Dead-stock alerts', 38),
  ('sales_debit_notes', 'Debit notes', 40),
  ('barcode_label_from_purchase', 'Print labels from a purchase', 42),
  ('barcode_label_templates', 'Label designer', 44),
  ('sales_work_orders', 'Work orders', 45),
  ('barcode_thermal_printer', 'Thermal label printers (ZPL)', 46),
  ('settings_backup', 'Backup & restore', 48),
  ('accounting_chart', 'Chart of accounts', 50),
  ('accounting_credit_approvals', 'Credit-limit approvals', 55),
  ('accounting_budgets', 'Budgets', 58),
  ('accounting_provisions', 'Provisions', 60),
  ('advanced_filters', 'Advanced filters', 70),
  ('bulk_actions', 'Bulk actions', 72),
  ('customizable_dashboard', 'Custom dashboard', 74),
  ('tools_todo', 'To-do list', 80),
  ('integration_whatsapp_bot', 'Shared inbox, AI agent & WhatsApp shop', 1),
  ('integration_whatsapp_manual', 'Custom & bulk WhatsApp messages', 3),
  ('hr_employees', 'Employee records', 1),
  ('hr_attendance', 'Attendance with the Khatario Staff app', 2),
  ('hr_payroll', 'Salary & payslips', 3),
  ('hr_leaves', 'Leave management', 4),
  ('hr_employee_portal', 'Employee self-service portal', 5)
) AS v(id, label, rank)
WHERE pf.id = v.id;

-- Limits shown as chips on the cards and as rows in the comparison table.
UPDATE platform_limits pl
SET show_on_pricing = true, pricing_label_one = v.one, pricing_label_many = v.many, pricing_rank = v.rank,
    updated_at = CURRENT_TIMESTAMP
FROM (VALUES
  ('max_users', 'user', 'users', 1),
  ('max_branches', 'branch', 'branches', 2),
  ('max_invoices_per_month', 'invoice a month', 'invoices a month', 3),
  ('max_whatsapp_per_day', 'WhatsApp message a day', 'WhatsApp messages a day', 4),
  ('max_eway_bills_per_month', 'e-Way bill a month', 'e-Way bills a month', 5),
  ('max_employees', 'employee', 'employees', 6),
  ('max_ai_replies_per_month', 'AI reply a month', 'AI replies a month', 7)
) AS v(limit_key, one, many, rank)
WHERE pl.limit_key = v.limit_key;

UPDATE subscription_plans SET pricing_badge = 'Most popular'
WHERE id IN ('growth', 'hr_pro') AND pricing_badge IS NULL;
