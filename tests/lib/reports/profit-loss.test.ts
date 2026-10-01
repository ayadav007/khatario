jest.mock('@/lib/db', () => ({ queryRows: jest.fn() }));
jest.mock('@/lib/services/cogs-calculator', () => ({ calculateCOGS: jest.fn() }));
jest.mock('@/lib/inventory/cogs-posting', () => ({ getInventoryModel: jest.fn() }));

import { assemblePl, flattenNodes, previousFinancialYear, type PlAccountRow } from '@/lib/reports/profit-loss';
import type { COGSCalculation } from '@/lib/services/cogs-calculator';

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

/** Khatario lines of the QA-PL-0930 journal on staging (Shalini Traders, 30 Sep 2026). */
const QA_PL_0930: PlAccountRow[] = [
  row('4101', 'income', '4100', 'cr', 10001),
  row('4903', 'income', '4100', 'cr', 10002),
  row('4201', 'income', '4000', 'cr', 1003),
  row('4202', 'income', '4000', 'cr', 1004),
  row('4901', 'income', '4000', 'cr', 1005),
  row('5299', 'expense', '5000', 'cr', 1008),
  row('4902', 'income', '4200', 'cr', 1009),
  row('4205', 'income', '4000', 'cr', 1010),
  row('4203', 'income', '4000', 'cr', 1011),
  row('4102', 'income', '4100', 'cr', 1012),
  row('4204', 'income', '4000', 'cr', 1013),
  row('5104', 'expense', '5100', 'dr', 2001),
  row('5901', 'expense', '5100', 'dr', 2002),
  row('5101', 'expense', '5100', 'dr', 2003),
  row('5102', 'expense', '5100', 'cr', 2004),
  row('5105', 'expense', '5100', 'dr', 2005),
  row('5106', 'expense', '5100', 'dr', 2006),
  row('5212', 'expense', '5200', 'dr', 3001),
  row('5213', 'expense', '5200', 'dr', 3002),
  row('5214', 'expense', '5200', 'dr', 3003),
  row('5215', 'expense', '5200', 'dr', 3004),
  row('5216', 'expense', '5200', 'dr', 3005),
  row('5217', 'expense', '5200', 'dr', 3006),
  row('5201', 'expense', '5000', 'dr', 3007),
  row('5202', 'expense', '5000', 'dr', 3008),
  row('5203', 'expense', '5000', 'dr', 3009),
  row('5204', 'expense', '5000', 'dr', 3010),
  row('5207', 'expense', '5000', 'dr', 3011),
  row('5902', 'expense', '5200', 'dr', 3012),
  row('5904', 'expense', '5200', 'dr', 3013, { parent_account_id: 'acc-5902' }),
  row('5903', 'expense', '5000', 'dr', 3014),
  row('5905', 'expense', '5200', 'dr', 3015, { is_active: false }),
  row('5205', 'expense', '5000', 'dr', 4001),
  row('5206', 'expense', '5000', 'dr', 4002),
  row('5218', 'expense', '5200', 'dr', 4003),
  row('5208', 'expense', '5000', 'dr', 4004),
  row('5209', 'expense', '5000', 'dr', 4005),
  row('5210', 'expense', '5000', 'dr', 4006),
  row('5211', 'expense', '5000', 'dr', 4007),
  row('4103', 'income', '6000', 'cr', 5001),
  row('5103', 'expense', '6000', 'dr', 5002),
];

const LEDGER_NET = -52084;

const codesIn = (pl: ReturnType<typeof assemblePl>, key: keyof ReturnType<typeof assemblePl>['sections']) =>
  flattenNodes(pl.sections[key].accounts).map((n) => n.account_code).sort();

describe('assemblePl — QA-PL-0930 golden (consolidated, perpetual)', () => {
  const pl = assemblePl(QA_PL_0930, { consolidated: true });

  it('totals each Zoho section', () => {
    expect(pl.sections.operating_income.total).toBe(24023);
    expect(pl.sections.cost_of_goods_sold.total).toBe(8013);
    expect(pl.sections.operating_expense.total).toBe(52117);
    expect(pl.sections.other_income.total).toBe(4043);
    expect(pl.sections.other_expense.total).toBe(20019);
  });

  it('computes the profit lines and agrees with the ledger', () => {
    expect(pl.gross_profit).toBe(16010);
    expect(pl.operating_profit).toBe(-36107);
    expect(pl.net_profit).toBe(LEDGER_NET);
    expect(pl.ledger_check).toEqual({ ledger_net: LEDGER_NET, inventory_adjustment: 0, difference: 0 });
  });

  it('places accounts like Zoho', () => {
    expect(codesIn(pl, 'operating_income')).toEqual(['4101', '4201', '4202', '4901', '4903', '5299']);
    expect(codesIn(pl, 'other_income')).toEqual(['4203', '4204', '4205', '4902']);
    expect(codesIn(pl, 'other_expense')).toEqual(['5205', '5206', '5210', '5211', '5218']);
    expect(codesIn(pl, 'operating_expense')).toEqual(expect.arrayContaining(['4102', '5204', '5207', '5208', '5209', '5905']));
  });

  it('shows contra accounts as negative lines', () => {
    const discount = flattenNodes(pl.sections.operating_expense.accounts).find((n) => n.account_code === '4102');
    expect(discount?.amount).toBe(-1012);
    const returns = flattenNodes(pl.sections.cost_of_goods_sold.accounts).find((n) => n.account_code === '5102');
    expect(returns?.amount).toBe(-2004);
  });

  it('keeps inactive accounts that have postings', () => {
    const inactive = flattenNodes(pl.sections.operating_expense.accounts).find((n) => n.account_code === '5905');
    expect(inactive).toMatchObject({ is_active: false, amount: 3015 });
  });

  it('nests sub-accounts under their parent', () => {
    const parent = pl.sections.operating_expense.accounts.find((n) => n.account_code === '5902');
    expect(parent?.amount).toBe(3012);
    expect(parent?.total).toBe(6025);
    expect(parent?.children.map((c) => c.account_code)).toEqual(['5904']);
    expect(pl.sections.operating_expense.accounts.some((n) => n.account_code === '5904')).toBe(false);
  });

  it('eliminates inter-branch accounts and keeps their difference in net profit', () => {
    expect(pl.elimination.applied).toBe(true);
    expect(pl.elimination.net).toBe(-1);
    expect(codesIn(pl, 'operating_income')).not.toContain('4103');
    expect(codesIn(pl, 'cost_of_goods_sold')).not.toContain('5103');
  });
});

describe('assemblePl — other views', () => {
  it('branch view reports inter-branch sales and purchases in their sections', () => {
    const pl = assemblePl(QA_PL_0930, { consolidated: false });
    expect(pl.elimination.applied).toBe(false);
    expect(pl.sections.operating_income.total).toBe(24023 + 5001);
    expect(pl.sections.cost_of_goods_sold.total).toBe(8013 + 5002);
    expect(pl.net_profit).toBe(LEDGER_NET);
    expect(pl.ledger_check.difference).toBe(0);
  });

  it('periodic books replace purchases with the stock schedule and explain the difference', () => {
    const cogs = {
      openingStock: { value: 1000 },
      purchases: { total: -1 },
      closingStock: { value: 500 },
    } as unknown as COGSCalculation;
    const pl = assemblePl(QA_PL_0930, { consolidated: true, periodic: cogs });
    expect(codesIn(pl, 'cost_of_goods_sold')).toEqual(['5104', '5105', '5106', '5901']);
    expect(pl.periodic_cogs).toEqual({ opening_stock: 1000, purchases: -1, closing_stock: 500, cost_of_goods_sold: 499 });
    expect(pl.sections.cost_of_goods_sold.total).toBe(2001 + 2002 + 2005 + 2006 + 499);
    expect(pl.net_profit).toBe(LEDGER_NET - 500);
    expect(pl.ledger_check.inventory_adjustment).toBe(-500);
    expect(pl.ledger_check.difference).toBe(0);
  });

  it('a stored section overrides the default and moves the total', () => {
    const rows = QA_PL_0930.map((r) => (r.account_code === '5903' ? { ...r, pl_section: 'other_expense' } : r));
    const pl = assemblePl(rows, { consolidated: true });
    expect(pl.sections.operating_expense.total).toBe(52117 - 3014);
    expect(pl.sections.other_expense.total).toBe(20019 + 3014);
    expect(pl.net_profit).toBe(LEDGER_NET);
  });

  it('hides zero accounts unless asked', () => {
    const rows = [...QA_PL_0930, row('5216', 'expense', '5200', 'dr', 0, { id: 'acc-zero', account_code: '5299X' })];
    expect(codesIn(assemblePl(rows, { consolidated: true }), 'operating_expense')).not.toContain('5299X');
    expect(codesIn(assemblePl(rows, { consolidated: true, includeZero: true }), 'operating_expense')).toContain('5299X');
  });

  it('does not nest a child under a parent in another section', () => {
    const rows = [
      row('5902', 'expense', '5200', 'dr', 100),
      row('5901', 'expense', '5100', 'dr', 50, { parent_account_id: 'acc-5902' }),
    ];
    const pl = assemblePl(rows, { consolidated: true });
    expect(pl.sections.operating_expense.accounts[0].children).toHaveLength(0);
    expect(pl.sections.cost_of_goods_sold.accounts.map((n) => n.account_code)).toEqual(['5901']);
  });
});

describe('previousFinancialYear', () => {
  it('steps back one Indian financial year', () => {
    expect(previousFinancialYear('2026-27')).toBe('2025-26');
    expect(previousFinancialYear('2000-01')).toBe('1999-00');
    expect(previousFinancialYear(null)).toBeUndefined();
    expect(previousFinancialYear('bad')).toBeUndefined();
  });
});
