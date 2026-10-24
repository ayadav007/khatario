-- Profit & Loss section per income/expense account, like Zoho Books' account types
-- (Income, Other Income, Cost of Goods Sold, Expense, Other Expense). The P&L report
-- (lib/reports/profit-loss.ts) groups accounts by this column instead of guessing from
-- group names and hard-coded codes. Posting never reads it.
--
-- Keep the system code map in sync with SYSTEM_PL_SECTIONS in lib/accounting/pl-sections.ts.
-- Re-runnable: the backfill only fills NULLs, so sections users changed are kept.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pl_section VARCHAR(30);

COMMENT ON COLUMN accounts.pl_section IS
  'P&L section for income/expense accounts: operating_income, cost_of_goods_sold, operating_expense, '
  'other_income, other_expense, elimination (inter-branch). NULL for balance-sheet accounts.';

CREATE OR REPLACE FUNCTION default_pl_section(
  p_account_type TEXT,
  p_account_code TEXT,
  p_is_system BOOLEAN,
  p_group_id UUID
) RETURNS VARCHAR AS $$
DECLARE
  v_group_code TEXT;
  v_group_type TEXT;
BEGIN
  IF p_account_type NOT IN ('income', 'expense') THEN
    RETURN NULL;
  END IF;

  IF COALESCE(p_is_system, true) THEN
    CASE p_account_code
      WHEN '4101' THEN RETURN 'operating_income';
      WHEN '4102' THEN RETURN 'operating_expense';
      WHEN '4103' THEN RETURN 'elimination';
      WHEN '4201' THEN RETURN 'operating_income';
      WHEN '4202' THEN RETURN 'operating_income';
      WHEN '4203' THEN RETURN 'other_income';
      WHEN '4204' THEN RETURN 'other_income';
      WHEN '4205' THEN RETURN 'other_income';
      WHEN '5101' THEN RETURN 'cost_of_goods_sold';
      WHEN '5102' THEN RETURN 'cost_of_goods_sold';
      WHEN '5103' THEN RETURN 'elimination';
      WHEN '5104' THEN RETURN 'cost_of_goods_sold';
      WHEN '5105' THEN RETURN 'cost_of_goods_sold';
      WHEN '5106' THEN RETURN 'cost_of_goods_sold';
      WHEN '5201' THEN RETURN 'operating_expense';
      WHEN '5202' THEN RETURN 'operating_expense';
      WHEN '5203' THEN RETURN 'operating_expense';
      WHEN '5204' THEN RETURN 'operating_expense';
      WHEN '5205' THEN RETURN 'other_expense';
      WHEN '5206' THEN RETURN 'other_expense';
      WHEN '5207' THEN RETURN 'operating_expense';
      WHEN '5208' THEN RETURN 'operating_expense';
      WHEN '5209' THEN RETURN 'operating_expense';
      WHEN '5210' THEN RETURN 'other_expense';
      WHEN '5211' THEN RETURN 'other_expense';
      WHEN '5212' THEN RETURN 'operating_expense';
      WHEN '5213' THEN RETURN 'operating_expense';
      WHEN '5214' THEN RETURN 'operating_expense';
      WHEN '5215' THEN RETURN 'operating_expense';
      WHEN '5216' THEN RETURN 'operating_expense';
      WHEN '5217' THEN RETURN 'operating_expense';
      WHEN '5218' THEN RETURN 'other_expense';
      WHEN '5299' THEN RETURN 'operating_income';
      ELSE NULL;
    END CASE;
  END IF;

  SELECT group_code, group_type INTO v_group_code, v_group_type
    FROM account_groups WHERE id = p_group_id;

  IF v_group_type = 'elimination' OR v_group_code = '6000' THEN
    RETURN 'elimination';
  END IF;
  IF p_account_type = 'income' THEN
    RETURN CASE WHEN v_group_code = '4200' THEN 'other_income' ELSE 'operating_income' END;
  END IF;
  RETURN CASE WHEN v_group_code = '5100' THEN 'cost_of_goods_sold' ELSE 'operating_expense' END;
END;
$$ LANGUAGE plpgsql STABLE;

-- Allowed placements per type; contra placements (income inside an expense section and the
-- reverse) report as negative lines, as in Zoho.
CREATE OR REPLACE FUNCTION pl_section_allowed(p_account_type TEXT, p_section TEXT) RETURNS BOOLEAN AS $$
  SELECT CASE p_account_type
    WHEN 'income'  THEN p_section IN ('operating_income', 'other_income', 'operating_expense', 'cost_of_goods_sold', 'elimination')
    WHEN 'expense' THEN p_section IN ('cost_of_goods_sold', 'operating_expense', 'other_expense', 'operating_income', 'elimination')
    ELSE false
  END;
$$ LANGUAGE sql IMMUTABLE;

-- Fill before adding the CHECK so existing rows satisfy it.
UPDATE accounts a
   SET pl_section = default_pl_section(a.account_type, a.account_code, a.is_system, a.account_group_id)
 WHERE a.account_type IN ('income', 'expense')
   AND a.pl_section IS NULL;

UPDATE accounts SET pl_section = NULL
 WHERE account_type NOT IN ('income', 'expense') AND pl_section IS NOT NULL;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_pl_section_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_pl_section_check CHECK (
  (account_type NOT IN ('income', 'expense') AND pl_section IS NULL)
  OR (account_type IN ('income', 'expense') AND pl_section IS NOT NULL AND pl_section_allowed(account_type, pl_section))
);

-- New accounts (seed functions, API, imports) get the default; a type change keeps a
-- still-valid section and otherwise falls back to the default.
CREATE OR REPLACE FUNCTION accounts_set_pl_section() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_type NOT IN ('income', 'expense') THEN
    NEW.pl_section := NULL;
  ELSIF NEW.pl_section IS NULL OR NOT pl_section_allowed(NEW.account_type, NEW.pl_section) THEN
    NEW.pl_section := default_pl_section(NEW.account_type, NEW.account_code, NEW.is_system, NEW.account_group_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The document totals report is not a Profit & Loss statement; only /reports/profit-loss is.
DO $$
BEGIN
  IF to_regclass('report_definitions') IS NOT NULL THEN
    UPDATE report_definitions
       SET name = 'Sales vs Purchases Summary',
           description = 'Document totals (invoices, bills, expenses) incl. GST. Not a Profit & Loss statement.'
     WHERE id = 'expense_profit_loss';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_accounts_set_pl_section ON accounts;
CREATE TRIGGER trg_accounts_set_pl_section
  BEFORE INSERT OR UPDATE OF account_type, pl_section, account_group_id ON accounts
  FOR EACH ROW EXECUTE FUNCTION accounts_set_pl_section();
