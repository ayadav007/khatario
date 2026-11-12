jest.mock('@/lib/db', () => ({ queryRows: jest.fn() }));
jest.mock('@/lib/services/cogs-calculator', () => ({ calculateCOGS: jest.fn() }));
jest.mock('@/lib/inventory/cogs-posting', () => ({ getInventoryModel: jest.fn() }));

import { assemblePl } from '@/lib/reports/profit-loss';
import { SYSTEM_PL_SECTIONS } from '@/lib/accounting/pl-sections';
import {
  assembleSchedule3,
  shiftYearBack,
  STOCK_PURCHASE_VOUCHER_TYPES,
  STOCK_BRANCH_PURCHASE_VOUCHER_TYPES,
  STOCK_OPENING_VOUCHER_TYPES,
  type Schedule3AccountRow,
} from '@/lib/reports/schedule3-pl';

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
  extra: Partial<Schedule3AccountRow> = {}
): Schedule3AccountRow {
  return {
    id: `acc-${code}`,
    account_code: code,
    account_name: `Account ${code}`,
    account_type: type,
    is_active: true,
    is_system: !code.startsWith('49') && !code.startsWith('59'),
    parent_account_id: null,
    pl_section: null,
    schedule3_line: null,
    group_code: group,
    group_type: group === '6000' ? 'elimination' : type,
    group_name: GROUP_NAMES[group],
    debit: side === 'dr' ? amount : 0,
    credit: side === 'cr' ? amount : 0,
    ...extra,
  };
}

const s = (rows: Schedule3AccountRow[], opts: any) => assembleSchedule3(rows, { consolidated: true, ...opts });
const amt = (st: ReturnType<typeof assembleSchedule3>, key: any) => st.lines[key as keyof typeof st.lines].amount;

describe('assembleSchedule3', () => {
  test('a) perpetual trader', () => {
    const st = s(
      [
        row('4101', 'income', '4100', 'cr', 1000),
        row('5104', 'expense', '5100', 'dr', 600),
        row('5212', 'expense', '5200', 'dr', 100),
        row('5210', 'expense', '5200', 'dr', 30),
      ],
      { stock: [{ code: '1104', purchases: 800, movement: 200 }] }
    );
    expect(amt(st, 'purchases_stock_in_trade')).toBe(800);
    expect(amt(st, 'changes_in_inventories')).toBe(-200);
    expect(amt(st, 'employee_benefits')).toBe(100);
    expect(st.total_expenses).toBe(700);
    expect(st.profit_before_tax).toBe(300);
    expect(st.profit_for_period).toBe(270);
    expect(st.stock_basis).toBe('perpetual');
  });

  test('b) manufacturer', () => {
    const st = s([row('5104', 'expense', '5100', 'dr', 50)], {
      stock: [
        { code: '1160', purchases: 100, movement: 30 },
        { code: '1162', purchases: 0, movement: 20 },
      ],
    });
    expect(amt(st, 'materials_consumed')).toBe(70);
    expect(amt(st, 'purchases_stock_in_trade')).toBe(0);
    expect(amt(st, 'changes_in_inventories')).toBe(-20);
  });

  test('c) stock write-off is counted once', () => {
    const st = s([row('5104', 'expense', '5100', 'dr', 60), row('5106', 'expense', '5100', 'dr', 5)], {
      stock: [{ code: '1104', purchases: 100, movement: 35 }],
    });
    expect(amt(st, 'purchases_stock_in_trade')).toBe(100);
    expect(amt(st, 'changes_in_inventories')).toBe(-40);
    expect(amt(st, 'other_expenses')).toBe(5);
    expect(st.total_expenses).toBe(65);
  });

  test('d) periodic books use the stock schedule', () => {
    const periodic = { openingStock: { value: 500 }, purchases: { total: 900 }, closingStock: { value: 300 } } as any;
    const st = s([row('5101', 'expense', '5100', 'dr', 950), row('5102', 'expense', '5100', 'cr', 50)], { periodic });
    expect(amt(st, 'purchases_stock_in_trade')).toBe(900);
    expect(amt(st, 'changes_in_inventories')).toBe(200);
    expect(st.lines.purchases_stock_in_trade.rows.every((r) => r.id === null)).toBe(true);
    expect(st.stock_basis).toBe('periodic');
  });

  test('e) inter-branch accounts', () => {
    const rows = [row('4103', 'income', '6000', 'cr', 100), row('5103', 'expense', '6000', 'dr', 90)];
    const all = assembleSchedule3(rows, { consolidated: true });
    expect(all.elimination_net).toBe(10);
    expect(all.total_income).toBe(0);
    expect(all.profit_for_period).toBe(10);
    const branch = assembleSchedule3(rows, { consolidated: false });
    expect(amt(branch, 'revenue_from_operations')).toBe(100);
    expect(amt(branch, 'purchases_stock_in_trade')).toBe(90);
    expect(branch.elimination_net).toBe(0);
  });

  test('f) profit equals the Standard report for every seeded code, both models, both views', () => {
    const rows = Object.keys(SYSTEM_PL_SECTIONS).map((code, i) =>
      row(
        code,
        code.startsWith('4') ? 'income' : 'expense',
        ['4103', '5103'].includes(code) ? '6000' : code.startsWith('4') ? '4100' : code.startsWith('51') ? '5100' : '5200',
        code.startsWith('4') ? 'cr' : 'dr',
        1000 + i * 7
      )
    );
    rows.push(
      row('5901', 'expense', '5200', 'dr', 333, { is_system: false }),
      row('4901', 'income', '4200', 'cr', 444, { is_system: false })
    );
    const periodic = { openingStock: { value: 500 }, purchases: { total: 900 }, closingStock: { value: 300 } } as any;
    const stock = [
      { code: '1104', purchases: 1234.56, movement: -78.9 },
      { code: '1160', purchases: 10, movement: 99 },
    ];
    for (const consolidated of [true, false]) {
      expect(assembleSchedule3(rows, { consolidated, stock }).profit_for_period).toBe(
        assemblePl(rows, { consolidated }).net_profit
      );
      expect(assembleSchedule3(rows, { consolidated, periodic }).profit_for_period).toBe(
        assemblePl(rows, { consolidated, periodic }).net_profit
      );
    }
  });

  test('h) periodic books, 5101 placed in the elimination section', () => {
    const periodic = { openingStock: { value: 500 }, purchases: { total: 900 }, closingStock: { value: 300 } } as any;
    const rows = [
      row('4101', 'income', '4100', 'cr', 1000),
      row('5101', 'expense', '5100', 'dr', 950, { pl_section: 'elimination' }),
      row('5102', 'expense', '5100', 'cr', 50),
    ];
    for (const consolidated of [true, false]) {
      expect(assembleSchedule3(rows, { consolidated, periodic }).profit_for_period).toBe(
        assemblePl(rows, { consolidated, periodic }).net_profit
      );
    }
  });

  test('i) periodic books with stock values beyond two decimals still match Standard', () => {
    const cases = [
      { o: 100.006, p: 0, c: 50.004 },
      { o: 333.335, p: 1234.565, c: 77.775 },
      { o: 0.005, p: 0.005, c: 0 },
      { o: 12345.674999, p: 98765.435001, c: 4321.115 },
    ];
    for (const { o, p, c } of cases) {
      const periodic = { openingStock: { value: o }, purchases: { total: p }, closingStock: { value: c } } as any;
      const rows = [row('4101', 'income', '4100', 'cr', 1000)];
      for (const consolidated of [true, false]) {
        const st = assembleSchedule3(rows, { consolidated, periodic });
        expect(st.profit_for_period).toBe(assemblePl(rows, { consolidated, periodic }).net_profit);
        const sum = st.lines.purchases_stock_in_trade.amount + st.lines.changes_in_inventories.amount;
        expect(Math.round(sum * 100) / 100).toBe(Math.round((o + p - c) * 100) / 100);
      }
    }
  });

  test('g) no stock figures: cost stays in changes in inventories', () => {
    const st = s([row('5104', 'expense', '5100', 'dr', 60)], {});
    expect(amt(st, 'changes_in_inventories')).toBe(60);
  });
});

test('stock voucher type lists (debit_note is a customer document, not a purchase return)', () => {
  expect(STOCK_PURCHASE_VOUCHER_TYPES).toEqual(['purchase', 'purchase_return']);
  expect(STOCK_BRANCH_PURCHASE_VOUCHER_TYPES).toEqual(['inter_branch_receipt']);
  expect(STOCK_OPENING_VOUCHER_TYPES).toEqual(['opening_stock', 'opening_balance']);
});

test('shiftYearBack', () => {
  expect(shiftYearBack('2026-09-30')).toBe('2025-09-30');
  expect(shiftYearBack('2024-02-29')).toBe('2023-02-28');
  expect(shiftYearBack('2026-04-01')).toBe('2025-04-01');
});
