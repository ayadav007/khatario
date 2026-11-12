jest.mock('@/lib/db', () => ({ queryRows: jest.fn() }));
jest.mock('@/lib/services/cogs-calculator', () => ({ calculateCOGS: jest.fn() }));
jest.mock('@/lib/inventory/cogs-posting', () => ({ getInventoryModel: jest.fn() }));

import { assemblePl, REPORT_SECTIONS, type PlAccountRow, type ProfitAndLoss } from '@/lib/reports/profit-loss';
import { mergeProfitAndLoss, columnNotes, assertConsistentStockBasis, type ComparedPl } from '@/lib/reports/profit-loss-compare';

const GROUP_NAMES: Record<string, string> = {
  '4000': 'Income',
  '4100': 'Sales',
  '4200': 'Other Income',
  '5000': 'Expenses',
  '5100': 'Direct Expenses',
  '5200': 'Indirect Expenses',
  '6000': 'Elimination',
};

function row(
  code: string,
  type: 'income' | 'expense',
  group: string,
  side: 'dr' | 'cr',
  amount: number,
  extra: Partial<PlAccountRow> = {}
): PlAccountRow {
  return {
    id: `acc-${code}`,
    account_code: code,
    account_name: `Account ${code}`,
    account_type: type,
    is_active: true,
    is_system: !code.startsWith('49') && !code.startsWith('59'),
    parent_account_id: null,
    pl_section: null,
    group_code: group,
    group_type: group === '6000' ? 'elimination' : type,
    group_name: GROUP_NAMES[group],
    debit: side === 'dr' ? amount : 0,
    credit: side === 'cr' ? amount : 0,
    ...extra,
  };
}

const report = (rows: PlAccountRow[], periodic: any = null): ProfitAndLoss => ({
  ...assemblePl(rows, { consolidated: true, includeZero: true, periodic }),
  inventory_model: periodic ? 'periodic' : 'perpetual',
  cogs_detail: periodic,
});
const section = (m: ComparedPl, key: string) => m.sections.find((s) => s.key === key)!;

test('an account present in one period only is listed once', () => {
  const a = report([row('4101','income','4100','cr',1000), row('5213','expense','5200','dr',200)]);
  const b = report([row('4101','income','4100','cr',600), row('5213','expense','5200','dr',150), row('5215','expense','5200','dr',50)]);
  const m = mergeProfitAndLoss([a, b], { includeZero: false });
  expect(m.net_profit).toEqual([800, 400]);
  expect(m.gross_profit).toEqual([1000, 600]);
  const opex = section(m, 'operating_expense');
  expect(opex.totals).toEqual([200, 200]);
  expect(opex.rows.map((r) => r.account_code)).toEqual(['5213', '5215']);
  expect(opex.rows[1].amounts).toEqual([0, 50]);
  expect(section(m, 'operating_income').rows[0].amounts).toEqual([1000, 600]);
});
test('a sub-account that exists in one period stays under its parent', () => {
  const child = (amt: number) => row('5913','expense','5200','dr',amt,{ is_system: false, parent_account_id: 'acc-5213' });
  const a = report([row('5213','expense','5200','dr',200), child(30)]);
  const b = report([row('5213','expense','5200','dr',150)]);
  const rows = section(mergeProfitAndLoss([a, b], { includeZero: false }), 'operating_expense').rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].amounts).toEqual([200, 150]);
  expect(rows[0].totals).toEqual([230, 150]);
  expect(rows[0].children.map((c) => c.account_code)).toEqual(['5913']);
  expect(rows[0].children[0].amounts).toEqual([30, 0]);
});
test('rows nil in every period are dropped unless asked for', () => {
  const rows = [row('5213','expense','5200','dr',200), row('5214','expense','5200','dr',0)];
  const codes = (includeZero: boolean) =>
    section(mergeProfitAndLoss([report(rows), report(rows)], { includeZero }), 'operating_expense').rows.map((r) => r.account_code);
  expect(codes(false)).toEqual(['5213']);
  expect(codes(true)).toEqual(['5213', '5214']);
});
test('totals and profits are the builder\'s own', () => {
  const a = report([row('4101','income','4100','cr',1000), row('5104','expense','5100','dr',600), row('5205','expense','5200','dr',40), row('5210','expense','5200','dr',30)]);
  const b = report([row('4101','income','4100','cr',500), row('4203','income','4000','cr',20)]);
  const m = mergeProfitAndLoss([a, b], { includeZero: false });
  [a, b].forEach((r, i) => {
    expect(m.sections.map((s) => s.totals[i])).toEqual(REPORT_SECTIONS.map((k) => r.sections[k].total));
    expect(m.gross_profit[i]).toBe(r.gross_profit);
    expect(m.operating_profit[i]).toBe(r.operating_profit);
    expect(m.net_profit[i]).toBe(r.net_profit);
    expect(m.profit_before_tax[i]).toBe(r.earnings.profit_before_tax);
    expect(m.ebit[i]).toBe(r.earnings.ebit);
    expect(m.ebitda[i]).toBe(r.earnings.ebitda);
  });
});
test('periodic stock rows per period', () => {
  const per = (o: number, p: number, c: number) => ({ openingStock: { value: o }, purchases: { total: p }, closingStock: { value: c } });
  const m = mergeProfitAndLoss([report([], per(500, 900, 300)), report([], per(300, 700, 500))], { includeZero: false });
  expect(section(m, 'cost_of_goods_sold').stock).toEqual({ opening_stock: [500, 300], purchases: [900, 700], closing_stock: [300, 500] });
  expect(section(m, 'operating_income').stock).toBeNull();
});
test('inter-branch difference per period', () => {
  const a = report([row('4103','income','6000','cr',100), row('5103','expense','6000','dr',90)]);
  const m = mergeProfitAndLoss([a, report([])], { includeZero: false });
  expect(m.elimination).toEqual({ applied: true, net: [10, 0] });
});
test('column notes', () => {
  const clean = report([row('4101','income','4100','cr',1000)]);
  expect(columnNotes({ from: '2026-04-01', to: '2026-09-30' }, clean)).toEqual([]);
  expect(columnNotes({ from: '2026-01-01', to: '2026-06-30' }, clean)).toEqual([
    '1 Jan 2026 – 30 Jun 2026 crosses a financial year end. Its opening stock and purchases belong to different years, so treat it as a management figure.',
  ]);
  const off = { ...clean, ledger_check: { ...clean.ledger_check, difference: -5 } };
  expect(columnNotes({ from: '2026-04-01', to: '2026-09-30' }, off)).toEqual([
    '1 Apr 2026 – 30 Sep 2026 differs from the ledger by ₹5.00. Please report this.',
  ]);
});
test('column note for closing stock not taken from a snapshot', () => {
  const per = (source: string) => ({
    openingStock: { value: 500 },
    purchases: { total: 900, gross_purchases: 900 },
    closingStock: { value: 300, source },
  });
  const period = { from: '2026-04-01', to: '2026-09-30' };
  const derived = columnNotes(period, report([], per('movements_derived')));
  expect(derived).toHaveLength(1);
  expect(derived[0].startsWith('1 Apr 2026 – 30 Sep 2026: Closing stock for this period is derived from live inventory')).toBe(true);
  expect(columnNotes(period, report([], per('snapshot')))).toEqual([]);
});
test('an inactive parent missing from one period still totals its sub-account', () => {
  const parent = row('5900', 'expense', '5200', 'dr', 100, { is_system: false, is_active: false });
  const child = (amt: number) => row('5910', 'expense', '5200', 'dr', amt, { is_system: false, parent_account_id: 'acc-5900' });
  const withParent = report([parent, child(30)]);
  const withoutParent = report([child(40)]);
  const cases: Array<[ProfitAndLoss[], number[], number[], number[]]> = [
    [[withParent, withoutParent], [100, 0], [130, 40], [30, 40]],
    [[withoutParent, withParent], [0, 100], [40, 130], [40, 30]],
  ];
  for (const [reports, amounts, totals, childAmounts] of cases) {
    const opex = section(mergeProfitAndLoss(reports, { includeZero: false }), 'operating_expense');
    expect(opex.rows).toHaveLength(1);
    expect(opex.rows[0].account_code).toBe('5900');
    expect(opex.rows[0].amounts).toEqual(amounts);
    expect(opex.rows[0].totals).toEqual(totals);
    expect(opex.rows[0].children.map((c) => c.amounts)).toEqual([childAmounts]);
    expect(opex.totals).toEqual(totals);
  }
});
test('periods on different stock bases are refused', () => {
  const per = { openingStock: { value: 500 }, purchases: { total: 900 }, closingStock: { value: 300 } };
  const periodic = report([], per);
  const fellBack: ProfitAndLoss = { ...report([]), inventory_model: 'periodic' };
  expect(() => assertConsistentStockBasis([periodic, fellBack])).toThrow('The stock schedule could not be worked out for every period. Please try again.');
  expect(() => assertConsistentStockBasis([periodic, periodic])).not.toThrow();
  expect(() => assertConsistentStockBasis([report([]), report([])])).not.toThrow();
  expect(() => assertConsistentStockBasis([fellBack, fellBack])).not.toThrow();
});
