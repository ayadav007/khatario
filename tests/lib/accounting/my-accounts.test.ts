import { resolveMyAccounts, type AccountActivity, type MyAccountSource, type MyGroupSource } from '@/lib/accounting/my-accounts';

const groups: MyGroupSource[] = [
  { id: 'g-assets', group_code: '1000', parent_group_id: null },
  { id: 'g-current', group_code: '1100', parent_group_id: 'g-assets' },
  { id: 'g-expenses', group_code: '5000', parent_group_id: null },
  { id: 'g-indirect', group_code: '5200', parent_group_id: 'g-expenses' },
  { id: 'g-direct', group_code: '5100', parent_group_id: 'g-expenses' },
];

const accounts: MyAccountSource[] = [
  { id: 'parent', account_code: '5201', parent_account_id: null, account_group_id: 'g-indirect', nature: 'debit' },
  { id: 'child', account_code: '5202', parent_account_id: 'parent', account_group_id: 'g-indirect', nature: 'debit' },
  { id: 'grand', account_code: '5203', parent_account_id: 'child', account_group_id: 'g-indirect', nature: 'debit' },
  { id: 'cash', account_code: '1101', parent_account_id: null, account_group_id: 'g-current', nature: 'debit' },
  { id: 'idle', account_code: '5209', parent_account_id: null, account_group_id: 'g-indirect', nature: 'debit' },
  { id: 'display-only', account_code: '5210', parent_account_id: null, account_group_id: 'g-direct', nature: 'debit' },
];

function activity(rows: Array<[string, number, number, number]>): Map<string, AccountActivity> {
  return new Map(rows.map(([id, debit, credit, lineCount]) => [id, { debit, credit, lineCount }]));
}

function visible(manual: string[], lines: Array<[string, number, number, number]>) {
  return resolveMyAccounts({
    accounts,
    groups,
    activityByAccount: activity(lines),
    manualAccountIds: manual,
  });
}

describe('my accounts visibility', () => {
  test('a settled account stays visible and its parent is not given the child balance', () => {
    const result = visible([], [
      ['grand', 10, 10, 2],
      ['cash', 10, 10, 2],
    ]);
    const grand = result.accounts.find((row) => row.id === 'grand');
    const child = result.accounts.find((row) => row.id === 'child');
    const parent = result.accounts.find((row) => row.id === 'parent');
    expect(grand).toMatchObject({ reason: 'activity', hasActivity: true, balance: 0 });
    expect(child).toMatchObject({ reason: 'ancestor', hasActivity: false, balance: 0, debit: 0, credit: 0 });
    expect(parent).toMatchObject({ reason: 'ancestor', balance: 0 });
    expect(result.accounts.map((row) => row.id)).toEqual(['parent', 'child', 'grand', 'cash']);
    expect(result.groupIds).toEqual(['g-assets', 'g-current', 'g-expenses', 'g-indirect']);
  });

  test('an opening voucher counts, and a display-only opening amount does not', () => {
    const result = visible([], [['cash', 20, 0, 1]]);
    expect(result.accounts.map((row) => row.id)).toEqual(['cash']);
    expect(result.accounts[0]).toMatchObject({ reason: 'activity', balance: 20 });
    expect(result.accounts.some((row) => row.id === 'display-only')).toBe(false);
  });

  test('manual selection shows an unused account and hides it again when removed', () => {
    const pinned = visible(['idle'], []);
    expect(pinned.accounts.find((row) => row.id === 'idle')).toMatchObject({
      reason: 'manual',
      hasActivity: false,
      balance: 0,
    });

    const cleared = visible([], []);
    expect(cleared.accounts.some((row) => row.id === 'idle')).toBe(false);
  });

  test('clearing a manual pin keeps an account that has its own ledger lines', () => {
    const result = visible([], [['idle', 5, 0, 1]]);
    expect(result.accounts.find((row) => row.id === 'idle')).toMatchObject({ reason: 'activity', balance: 5 });
  });

  test('removing one unused child keeps an ancestor that another account still needs', () => {
    const sibling = {
      id: 'sibling',
      account_code: '5204',
      parent_account_id: 'parent',
      account_group_id: 'g-indirect',
      nature: 'debit',
    };
    const withBoth = resolveMyAccounts({
      accounts: [...accounts, sibling],
      groups,
      activityByAccount: activity([['grand', 4, 0, 1]]),
      manualAccountIds: ['sibling'],
    });
    expect(withBoth.accounts.find((row) => row.id === 'sibling')).toMatchObject({ reason: 'manual' });
    expect(withBoth.accounts.find((row) => row.id === 'parent')?.reason).toBe('ancestor');

    const withoutSibling = resolveMyAccounts({
      accounts: [...accounts, sibling],
      groups,
      activityByAccount: activity([['grand', 4, 0, 1]]),
      manualAccountIds: [],
    });
    expect(withoutSibling.accounts.some((row) => row.id === 'sibling')).toBe(false);
    expect(withoutSibling.accounts.find((row) => row.id === 'parent')).toMatchObject({
      reason: 'ancestor',
      balance: 0,
      debit: 0,
      credit: 0,
    });
    expect(withoutSibling.accounts.find((row) => row.id === 'grand')?.balance).toBe(4);
  });

  test('an opening voucher is shown as opening, and later entries stay in debit and credit', () => {
    const result = resolveMyAccounts({
      accounts,
      groups,
      activityByAccount: new Map([
        ['cash', { debit: 590, credit: 0, lineCount: 2, openingDebit: 100, openingCredit: 0 }],
      ]),
      manualAccountIds: [],
    });
    expect(result.accounts.find((row) => row.id === 'cash')).toMatchObject({
      opening: 100,
      openingSide: 'Dr',
      debit: 590,
      credit: 0,
      closing: 690,
      balanceSide: 'Dr',
      balance: 690,
    });
  });

  test('an unknown manual id and another group are ignored', () => {
    const result = visible(['missing', 'idle'], []);
    expect(result.accounts.map((row) => row.id)).toEqual(['idle']);
    expect(result.groupIds).not.toContain('g-direct');
    expect(result.groupIds).toContain('g-expenses');
  });
});
