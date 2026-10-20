import {
  NATURE_FOR_TYPE,
  accountAncestorNames,
  descendantIds,
  groupAncestorNames,
  parentCreatesCycle,
  parentSelectionPath,
  parentTypeError,
  parseOpeningBalance,
  suggestNextAccountCode,
} from '@/lib/accounting/account-hierarchy';

const groups = [
  { id: 'g-exp', group_name: 'Expenses', parent_group_id: null },
  { id: 'g-ind', group_name: 'Indirect Expenses', parent_group_id: 'g-exp' },
];

const accounts = [
  { id: 'a-exp', account_name: 'Expenses', parent_account_id: null, account_group_id: 'g-exp', account_type: 'expense' },
  { id: 'a-ind', account_name: 'Indirect Expenses', parent_account_id: 'a-exp', account_group_id: 'g-ind', account_type: 'expense' },
  { id: 'a-elec', account_name: 'Electricity Expense', parent_account_id: 'a-ind', account_group_id: 'g-ind', account_type: 'expense' },
  { id: 'a-cash', account_name: 'Cash', parent_account_id: null, account_group_id: 'g-asset', account_type: 'asset' },
];

describe('account hierarchy rules', () => {
  it('suggests the next free code inside the type range and skips collisions', () => {
    expect(suggestNextAccountCode(['1101', '1108', '2101'], 'asset')).toBe('1109');
    expect(suggestNextAccountCode(['1101', '1109'], 'asset')).toBe('1110');
    expect(suggestNextAccountCode(['5205'], 'expense')).toBe('5206');
    expect(suggestNextAccountCode([], 'income')).toBe('4001');
  });

  it('builds a top-level account with no parent path beyond its group and name', () => {
    expect(parentSelectionPath({
      accountId: 'a-cash',
      accounts,
      groups: [{ id: 'g-asset', group_name: 'Current Assets', parent_group_id: null }],
    })).toBe('Current Assets → Cash');
    expect(accountAncestorNames(accounts, 'a-cash')).toEqual(['Cash']);
  });

  it('shows group classification and the ledger parent chain together', () => {
    expect(groupAncestorNames(groups, 'g-ind')).toEqual(['Expenses', 'Indirect Expenses']);
    expect(parentSelectionPath({ accountId: 'a-elec', accounts, groups })).toBe(
      'Expenses → Indirect Expenses → Electricity Expense',
    );
    const withOffice = accounts.map((a) =>
      a.id === 'a-elec' ? { ...a, parent_account_id: 'a-office' } : a,
    ).concat({
      id: 'a-office',
      account_name: 'Office Overheads',
      parent_account_id: null,
      account_group_id: 'g-ind',
      account_type: 'expense',
    });
    expect(parentSelectionPath({ accountId: 'a-elec', accounts: withOffice, groups })).toBe(
      'Expenses → Indirect Expenses → Office Overheads → Electricity Expense',
    );
  });

  it('accepts a parent of the same type and rejects a different type', () => {
    expect(parentTypeError('expense', 'expense')).toBeNull();
    expect(parentTypeError('expense', 'asset')).toMatch(/another expense account/);
  });

  it('rejects self-parenting and a parent that is already a descendant', () => {
    const links = accounts.map((a) => ({ id: a.id, parent_account_id: a.parent_account_id }));
    expect(parentCreatesCycle(links, 'a-elec', 'a-elec')).toBe('self');
    expect(parentCreatesCycle(links, 'a-exp', 'a-elec')).toBe('cycle');
    expect(parentCreatesCycle(links, 'a-elec', 'a-ind')).toBe(null);
    expect(parentCreatesCycle(links, null, 'a-ind')).toBe(null);
    expect(descendantIds(links, 'a-exp')).toEqual(new Set(['a-ind', 'a-elec']));
  });

  it('locks debit and credit nature to the existing account types', () => {
    expect(NATURE_FOR_TYPE.asset).toBe('debit');
    expect(NATURE_FOR_TYPE.expense).toBe('debit');
    expect(NATURE_FOR_TYPE.liability).toBe('credit');
    expect(NATURE_FOR_TYPE.income).toBe('credit');
    expect(NATURE_FOR_TYPE.capital).toBe('credit');
  });

  it('rejects a negative opening balance and keeps a zero balance as a non-posting amount', () => {
    expect(parseOpeningBalance(-10, 'debit').ok).toBe(false);
    expect(parseOpeningBalance('abc', 'debit').ok).toBe(false);
    expect(parseOpeningBalance(0, 'debit')).toEqual({ ok: true, amount: 0, type: 'debit' });
    expect(parseOpeningBalance('12.345', 'credit')).toEqual({ ok: true, amount: 12.35, type: 'credit' });
  });
});
