import { isOrdinaryOperatingExpenseAccount } from '@/lib/accounting/expense-account-policy';

const account = (patch: Record<string, unknown>) =>
  ({
    account_code: '5290',
    account_type: 'expense',
    is_system: false,
    pl_section: 'operating_expense',
    group_code: '5200',
    ...patch,
  }) as never;

describe('ordinary expense category accounts', () => {
  it('allows an operating expense account', () => {
    expect(isOrdinaryOperatingExpenseAccount(account({ account_code: '5213', pl_section: 'operating_expense' }))).toBe(true);
    expect(isOrdinaryOperatingExpenseAccount(account({ account_code: '5201', is_system: true, pl_section: null }))).toBe(true);
  });

  it('rejects purchases, COGS, stock loss, other expenses, assets, and liabilities', () => {
    for (const code of ['5101', '5104', '5105', '5106']) {
      expect(isOrdinaryOperatingExpenseAccount(account({ account_code: code, is_system: true, pl_section: null }))).toBe(false);
    }
    expect(isOrdinaryOperatingExpenseAccount(account({ account_code: '5205', is_system: true, pl_section: null }))).toBe(false);
    expect(
      isOrdinaryOperatingExpenseAccount(account({ account_code: '1201', account_type: 'asset', pl_section: null }))
    ).toBe(false);
    expect(
      isOrdinaryOperatingExpenseAccount(account({ account_code: '2101', account_type: 'liability', pl_section: null }))
    ).toBe(false);
    expect(isOrdinaryOperatingExpenseAccount(account({ pl_section: 'cost_of_goods_sold', group_code: '5100' }))).toBe(false);
  });

  it('rejects a missing account', () => {
    expect(isOrdinaryOperatingExpenseAccount(null)).toBe(false);
  });
});
