-- Migration 150: Seed field_permissions for sensitive fields in core modules.
--
-- By default, when no row exists in field_permissions, the app allows view but denies edit.
-- This migration explicitly seeds restrictions for commonly sensitive fields
-- so that non-admin roles have a documented baseline.
--
-- These rows are only inserted for NON-primary_admin roles.
-- Primary admins bypass field-level checks.

-- Helper: insert field permissions for all non-primary-admin roles in every business.
-- For each role, restrict edit on sensitive financial fields but allow view.
INSERT INTO field_permissions (role_id, module_key, field_name, can_view, can_edit)
SELECT ur.id, m.module_key, m.field_name, m.can_view, m.can_edit
FROM user_roles ur
CROSS JOIN (VALUES
  -- Invoice sensitive fields
  ('invoices', 'discount_amount', true, false),
  ('invoices', 'discount_percent', true, false),
  ('invoices', 'tax_amount', true, false),
  ('invoices', 'total_amount', true, false),
  -- Purchase sensitive fields
  ('purchases', 'discount_amount', true, false),
  ('purchases', 'discount_percent', true, false),
  ('purchases', 'tax_amount', true, false),
  ('purchases', 'total_amount', true, false),
  -- Item sensitive fields
  ('items', 'purchase_price', true, false),
  ('items', 'cost_price', true, false),
  ('items', 'opening_stock', true, false),
  -- Customer/Supplier sensitive fields
  ('customers', 'credit_limit', true, false),
  ('suppliers', 'credit_limit', true, false),
  -- Employee sensitive fields
  ('employees', 'salary', false, false),
  ('employees', 'bank_account_number', false, false),
  -- Expense sensitive fields
  ('expenses', 'amount', true, false)
) AS m(module_key, field_name, can_view, can_edit)
WHERE ur.role_key != 'primary_admin'
ON CONFLICT DO NOTHING;
