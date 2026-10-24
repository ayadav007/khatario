-- Accounting actions that were open on every billing plan.
-- They start enabled on every billing plan, so current businesses keep them.
-- Turn one off for a plan from Admin → Plans → Features.

INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon)
VALUES
  ('accounting_chart', 'accounting', 'Chart of accounts',
   'Add and edit ledger accounts, account groups, and the industry chart', '/accounts', 1, true, false),
  ('accounting_bank', 'accounting', 'Bank import & reconciliation',
   'Import a bank statement and match it to ledger entries', '/bank/reconciliation', 2, true, false),
  ('accounting_tds', 'accounting', 'TDS / TCS',
   'Deduct TDS or TCS, keep categories, and print certificates', '/tds', 3, true, false),
  ('accounting_provisions', 'accounting', 'Provisions',
   'Record provisions and tax provisions', '/provisions', 4, true, false),
  ('accounting_credit_approvals', 'accounting', 'Credit approvals',
   'Ask for approval before selling or buying above a credit limit', '/credit-approvals', 5, true, false),
  ('accounting_budgets', 'accounting', 'Budgets',
   'Set account budgets and compare them to actuals', NULL, 6, true, false)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  route_path = EXCLUDED.route_path,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  is_addon = false,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT sp.id, f.feature_id, TRUE
FROM subscription_plans sp
CROSS JOIN (
  VALUES
    ('accounting_chart'),
    ('accounting_bank'),
    ('accounting_tds'),
    ('accounting_provisions'),
    ('accounting_credit_approvals'),
    ('accounting_budgets')
) AS f(feature_id)
WHERE sp.product_line = 'billing'
ON CONFLICT (plan_id, feature_id) DO NOTHING;
