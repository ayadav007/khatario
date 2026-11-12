-- Schedule III Profit & Loss: the owner can put one income or expense account on a different line.
-- Reports only. NULL means "use the default rule in lib/accounting/schedule3-lines.ts". Safe to run twice.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS schedule3_line VARCHAR(40);
COMMENT ON COLUMN accounts.schedule3_line IS
  'Schedule III Profit & Loss line chosen by the owner; NULL = default rule in lib/accounting/schedule3-lines.ts. Reports only.';
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_schedule3_line_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_schedule3_line_check CHECK (
  schedule3_line IS NULL OR (
    account_type IN ('income', 'expense') AND schedule3_line IN (
      'revenue_from_operations', 'other_income', 'purchases_stock_in_trade', 'employee_benefits',
      'finance_costs', 'depreciation_amortisation', 'other_expenses', 'exceptional_items',
      'current_tax', 'deferred_tax')));
