-- get_account_balance added accounts.opening_balance on top of ledger_entry_lines. Opening balances
-- are posted as `opening_balance` vouchers (lib/accounting/account-rules.ts) and the column is only
-- the displayed value, so every account with an opening was counted twice. The column branch also
-- negated a credit opening on a credit-nature account. The balance is now ledger lines only, matching
-- the balance sheet and trial balance.

CREATE OR REPLACE FUNCTION get_account_balance(
    p_account_id UUID,
    p_business_id UUID,
    p_as_on_date DATE DEFAULT NULL,
    p_branch_id UUID DEFAULT NULL
)
RETURNS DECIMAL(15,2) AS $$
DECLARE
    v_account_nature VARCHAR(10);
    v_debit_total DECIMAL(15,2);
    v_credit_total DECIMAL(15,2);
BEGIN
    SELECT nature
      INTO v_account_nature
      FROM accounts
     WHERE id = p_account_id AND business_id = p_business_id;

    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO v_debit_total, v_credit_total
      FROM ledger_entry_lines
     WHERE account_id = p_account_id
       AND business_id = p_business_id
       AND (p_as_on_date IS NULL OR entry_date <= p_as_on_date)
       -- Opening vouchers are business-level (no branch); a branch-scoped balance keeps them,
       -- as the old column-based opening did.
       AND (p_branch_id IS NULL OR branch_id = p_branch_id
            OR (branch_id IS NULL AND voucher_type = 'opening_balance'));

    IF v_account_nature = 'debit' THEN
        RETURN v_debit_total - v_credit_total;
    END IF;
    RETURN v_credit_total - v_debit_total;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_account_balance(UUID, UUID, DATE, UUID) IS
  'Account balance from ledger_entry_lines only (openings are opening_balance vouchers). Pass p_branch_id for branch-scoped balance; NULL = all branches.';
