-- Map each expense category to a chart-of-accounts expense head for ledger posting.
ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expense_categories_account_id
  ON expense_categories(account_id)
  WHERE account_id IS NOT NULL;

COMMENT ON COLUMN expense_categories.account_id IS
  'Ledger expense account (accounts.id, account_type=expense) used when posting expenses in this category.';
