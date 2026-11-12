import { buildReceivableAccountOptions, receivableAccountFilterIds } from '@/lib/customers/receivable-account-options';

const acc = (id: string, code: string, name: string, parent: string | null, active = true) => ({
  id,
  account_code: code,
  account_name: name,
  parent_account_id: parent,
  is_active: active,
});

const accounts = [
  acc('for', 'F1', 'Foreign Debtors', 'ar'),
  acc('ar', '1103', 'Accounts Receivable', null),
  acc('usa', 'F2', 'USA', 'for'),
  acc('dom', 'D1', 'Domestic Debtors', 'ar'),
  acc('old', 'D2', 'Closed Debtors', 'ar', false),
  acc('legacy', '110301', 'Old receivables', null),
];

describe('buildReceivableAccountOptions', () => {
  it('lists the control account first, then the tree in code order with depth', () => {
    const options = buildReceivableAccountOptions(accounts, 'ar');
    expect(options.map((o) => [o.id, o.depth])).toEqual([
      ['ar', 0],
      ['dom', 1],
      ['for', 1],
      ['usa', 2],
      ['legacy', 1],
    ]);
    expect(options[0]).toMatchObject({ isControl: true, label: '1103 Accounts Receivable' });
    expect(options[3].label).toBe('F2 USA');
  });

  it('leaves out an inactive account unless it is the one already chosen', () => {
    expect(buildReceivableAccountOptions(accounts, 'ar').some((o) => o.id === 'old')).toBe(false);
    const withChosen = buildReceivableAccountOptions(accounts, 'ar', 'old');
    expect(withChosen.find((o) => o.id === 'old')).toMatchObject({ depth: 1, inactive: true });
  });

  it('says whether there is anything to choose besides the control account', () => {
    expect(buildReceivableAccountOptions([acc('ar', '1103', 'Accounts Receivable', null)], 'ar')).toHaveLength(1);
    expect(buildReceivableAccountOptions([], null)).toEqual([]);
  });

  it('does not hang on a loop in parent links', () => {
    const looped = [acc('ar', '1103', 'Accounts Receivable', 'x'), acc('x', 'X', 'Loop', 'ar')];
    expect(buildReceivableAccountOptions(looped, 'ar').map((o) => o.id)).toEqual(['ar', 'x']);
  });
});


describe('receivableAccountFilterIds', () => {
  it('keeps an account and everything under it', () => {
    const keep = receivableAccountFilterIds(accounts, 'ar', 'for');
    expect(keep?.unassigned).toBe(false);
    expect([...(keep?.accountIds ?? [])].sort()).toEqual(['for', 'usa']);
  });

  it('keeps only customers with no account for the control account', () => {
    expect(receivableAccountFilterIds(accounts, 'ar', 'ar')).toEqual({ accountIds: new Set(), unassigned: true });
  });

  it('keeps everything when nothing is chosen', () => {
    expect(receivableAccountFilterIds(accounts, 'ar', '')).toBeNull();
  });
});
