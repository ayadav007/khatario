import {
  assembleBalanceSheet,
  classifyBsAccount,
  financialYearStartFor,
  type BsAccountRow,
  type GroupInfo,
} from '@/lib/reports/balance-sheet';

const G = (id: string, code: string | null, name: string, type: string, parentId: string | null = null): GroupInfo => ({
  id, code, name, type, parentId,
});
const groups = new Map<string, GroupInfo>(
  [
    G('assets', '1000', 'Assets', 'asset'),
    G('ca', '1100', 'Current Assets', 'asset', 'assets'),
    G('fa', '1200', 'Fixed Assets', 'asset', 'assets'),
    G('inv', '1300', 'Investments', 'asset', 'assets'),
    G('deposits', null, 'Security Deposits', 'asset', 'ca'),
    G('liab', '2000', 'Liabilities', 'liability'),
    G('cl', '2100', 'Current Liabilities', 'liability', 'liab'),
    G('lt', '2200', 'Long-term Liabilities', 'liability', 'liab'),
    G('cap', '3000', 'Capital', 'capital'),
    G('elim', '6000', 'Inter-Branch Transactions (Elimination)', 'elimination'),
  ].map((g) => [g.id, g])
);

let n = 0;
const row = (code: string, type: string, group: string | null, debit: number, credit: number, name = code): BsAccountRow => ({
  id: `a${++n}`,
  account_code: code,
  account_name: name,
  account_type: type,
  account_group_id: group,
  account_group_name: group,
  nature: type === 'asset' ? 'debit' : 'credit',
  is_active: true,
  debit,
  credit,
});

describe('classifyBsAccount', () => {
  it('follows the group chain and falls back to other assets / liabilities', () => {
    expect(classifyBsAccount('asset', 'deposits', groups)).toBe('current_asset');
    expect(classifyBsAccount('asset', 'fa', groups)).toBe('fixed_asset');
    expect(classifyBsAccount('asset', 'inv', groups)).toBe('investment');
    expect(classifyBsAccount('asset', 'assets', groups)).toBe('other_asset');
    expect(classifyBsAccount('asset', null, groups)).toBe('other_asset');
    expect(classifyBsAccount('liability', 'liab', groups)).toBe('other_liability');
    expect(classifyBsAccount('liability', 'lt', groups)).toBe('long_term_liability');
    expect(classifyBsAccount('asset', 'elim', groups)).toBe('current_asset');
    expect(classifyBsAccount('liability', 'elim', groups)).toBe('current_liability');
    expect(classifyBsAccount('capital', 'cap', groups)).toBe('equity');
    expect(classifyBsAccount('income', null, groups)).toBeNull();
  });
});

describe('assembleBalanceSheet', () => {
  // Same events as the 28-Sep-2026 Zoho comparison (docs/qa/reports-zoho-vs-khatario).
  const rows = [
    row('1101', 'asset', 'ca', 0, 7011),
    row('1102', 'asset', 'ca', 753040, 180050),
    row('1103', 'asset', 'ca', 59005, 40007),
    row('1105', 'asset', 'ca', 6009, 0),
    row('1110', 'asset', 'ca', 2700, 0),
    row('1111', 'asset', 'ca', 2700, 0),
    row('1201', 'asset', 'fa', 120003, 0),
    row('1202', 'asset', 'fa', 0, 12004, 'Accumulated Depreciation'),
    row('1301', 'asset', 'inv', 25013, 0),
    row('1901', 'asset', 'assets', 9017, 0),
    row('2101', 'liability', 'cl', 20008, 35406),
    row('2104', 'liability', 'cl', 0, 8010),
    row('2106', 'liability', 'cl', 0, 11012),
    row('2108', 'liability', 'cl', 0, 5016),
    row('2109', 'liability', 'cl', 0, 4015),
    row('2112', 'liability', 'cl', 0, 3014),
    row('2150', 'liability', 'cl', 0, 4500),
    row('2151', 'liability', 'cl', 0, 4500),
    row('2201', 'liability', 'lt', 0, 200002),
    row('2901', 'liability', 'liab', 0, 2018),
    row('3001', 'capital', 'cap', 0, 500001),
    row('3003', 'capital', 'cap', 7011, 0),
  ];

  it('reads every account from the ledger, including provisions, tax, fixed assets and custom groups', () => {
    const bs = assembleBalanceSheet(rows, groups, { previousYearsProfit: 0, currentYearProfit: -12060 });
    expect(bs.assets.current.total).toBe(596386);
    expect(bs.assets.fixed).toMatchObject({ total: 107999, gross_block: 120003, accumulated_depreciation: 12004, net_block: 107999 });
    expect(bs.assets.investments.total).toBe(25013);
    expect(bs.assets.other.total).toBe(9017);
    expect(bs.assets.total).toBe(738415);
    expect(bs.liabilities.current.total).toBe(55465);
    expect(bs.liabilities.current).toMatchObject({ provisions: 5016, current_tax: 4015 });
    expect(bs.liabilities.long_term.total).toBe(200002);
    expect(bs.liabilities.other.total).toBe(2018);
    expect(bs.equity.capital.total).toBe(492990);
    expect(bs.equity.retained_earnings.closing).toBe(-12060);
    expect(bs.total_liabilities_and_equity).toBe(738415);
    expect(bs.is_balanced).toBe(true);
    expect(bs.abnormal_balances).toEqual([
      { account_code: '1101', account_name: '1101', side: 'asset', amount: -7011 },
    ]);
  });

  it('keeps unclosed earlier-year profit apart from current-year earnings', () => {
    const bs = assembleBalanceSheet(
      [row('1102', 'asset', 'ca', 1500, 0), row('3001', 'capital', 'cap', 0, 1000)],
      groups,
      { previousYearsProfit: 300, currentYearProfit: 200 }
    );
    expect(bs.equity.retained_earnings).toMatchObject({ opening: 300, current_year_profit: 200, closing: 500 });
    expect(bs.is_balanced).toBe(true);
  });

  it('adds the periodic closing-stock adjustment to inventory so the sheet still balances', () => {
    const bs = assembleBalanceSheet(
      [row('1104', 'asset', 'ca', 2000, 0), row('1102', 'asset', 'ca', 0, 0), row('3001', 'capital', 'cap', 0, 2000)],
      groups,
      { previousYearsProfit: 0, currentYearProfit: 1000, inventoryAdjustment: 1000 }
    );
    expect(bs.assets.current.inventory).toBe(3000);
    expect(bs.assets.current.total).toBe(3000);
    expect(bs.is_balanced).toBe(true);
  });
});

describe('financialYearStartFor', () => {
  it('returns 1 April of the Indian financial year', () => {
    expect(financialYearStartFor('2026-09-28')).toBe('2026-04-01');
    expect(financialYearStartFor('2027-03-31')).toBe('2026-04-01');
    expect(financialYearStartFor('2026-04-01')).toBe('2026-04-01');
  });
});
