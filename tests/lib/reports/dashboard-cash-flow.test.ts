import {
  buildDashboardCashFlow,
  classifyCashMovement,
  type CashCounterAccount,
  type CashMovement,
} from '@/lib/reports/dashboard-cash-flow';

const counter = (code: string, type: string, extra: Partial<CashCounterAccount> = {}): CashCounterAccount => ({
  code,
  name: code,
  type,
  bsClass: null,
  ...extra,
});

const move = (month: string, direction: 'in' | 'out', amount: number, c: CashCounterAccount | null): CashMovement => ({
  month,
  direction,
  amount,
  counter: c,
});

describe('classifyCashMovement', () => {
  it('names money coming in by the account on the other side', () => {
    expect(classifyCashMovement('in', counter('3001', 'capital')).key).toBe('capital');
    expect(classifyCashMovement('in', counter('2202', 'liability', { bsClass: 'long_term_liability' })).key).toBe('loans');
    expect(classifyCashMovement('in', counter('4101', 'income')).key).toBe('sales');
    expect(classifyCashMovement('in', counter('1103', 'asset')).key).toBe('sales');
    expect(classifyCashMovement('in', counter('2106', 'liability')).key).toBe('sales');
    // A cash sale below cost: the stock line is larger than the sales line.
    expect(classifyCashMovement('in', counter('1104', 'asset')).key).toBe('sales');
    expect(classifyCashMovement('in', counter('4202', 'income')).key).toBe('other');
    expect(classifyCashMovement('in', counter('2101', 'liability')).key).toBe('other');
    expect(classifyCashMovement('in', null).key).toBe('other');
  });

  it('names money going out by the account on the other side', () => {
    expect(classifyCashMovement('out', counter('3003', 'capital')).key).toBe('drawings');
    expect(classifyCashMovement('out', counter('2201', 'liability', { bsClass: 'long_term_liability' })).key).toBe('loans');
    expect(classifyCashMovement('out', counter('2101', 'liability')).key).toBe('purchases');
    expect(classifyCashMovement('out', counter('5101', 'expense')).key).toBe('purchases');
    expect(classifyCashMovement('out', counter('1104', 'asset')).key).toBe('purchases');
    expect(classifyCashMovement('out', counter('5213', 'expense')).key).toBe('expenses');
    expect(classifyCashMovement('out', counter('5212', 'expense')).key).toBe('salaries');
    expect(classifyCashMovement('out', counter('2113', 'liability')).key).toBe('salaries');
    expect(classifyCashMovement('out', counter('1130', 'asset')).key).toBe('taxes');
    expect(classifyCashMovement('out', counter('2151', 'liability')).key).toBe('taxes');
    expect(classifyCashMovement('out', counter('1201', 'asset', { bsClass: 'fixed_asset' })).key).toBe('assets');
    expect(classifyCashMovement('out', counter('1103', 'asset')).key).toBe('refunds');
    expect(classifyCashMovement('out', null).key).toBe('other');
  });
});

describe('buildDashboardCashFlow', () => {
  const movements: CashMovement[] = [
    move('2026-05', 'in', 50000, counter('3001', 'capital')),
    move('2026-06', 'in', 118, counter('4101', 'income')),
    move('2026-06', 'out', 3000, counter('5213', 'expense')),
    move('2026-07', 'out', 500, counter('1130', 'asset')),
    move('2026-07', 'in', 10000, counter('2202', 'liability', { bsClass: 'long_term_liability' })),
    move('2026-08', 'out', 2000, counter('3003', 'capital')),
  ];
  const cf = buildDashboardCashFlow({ startYear: 2026, opening: 1000, movements });

  it('counts capital, loans and drawings, not only customer and supplier payments', () => {
    expect(cf.summary.opening_balance).toBe(1000);
    expect(cf.summary.total_incoming).toBe(60118);
    expect(cf.summary.total_outgoing).toBe(5500);
    expect(cf.summary.closing_balance).toBe(55618);
  });

  it('runs April to March with a closing balance carried month to month', () => {
    expect(cf.fiscal_year).toBe('2026-2027');
    expect(cf.months.map((m) => m.month)).toEqual([
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
      '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
    ]);
    expect(cf.months[0]).toMatchObject({ monthLabel: 'Apr 2026', opening: 1000, incoming: 0, outgoing: 0, closing: 1000 });
    expect(cf.months[1].closing).toBe(51000);
    expect(cf.months[2]).toMatchObject({ opening: 51000, incoming: 118, outgoing: 3000, closing: 48118 });
    expect(cf.months[3].closing).toBe(57618);
    expect(cf.months[4].closing).toBe(55618);
    expect(cf.months[11].closing).toBe(55618);
    expect(cf.chart_series).toHaveLength(13);
    expect(cf.chart_series[0]).toMatchObject({ month: 'opening', monthLabel: 'Opening (01 Apr 2026)', closing: 1000 });
  });

  it('breaks each side down by where the money came from or went', () => {
    expect(cf.summary.breakdown.incoming.lines).toEqual([
      { key: 'sales', label: 'Sales and customer receipts', amount: 118 },
      { key: 'capital', label: 'Capital added by owner', amount: 50000 },
      { key: 'loans', label: 'Loans received', amount: 10000 },
    ]);
    expect(cf.summary.breakdown.outgoing.lines).toEqual([
      { key: 'expenses', label: 'Expenses', amount: 3000 },
      { key: 'taxes', label: 'Taxes paid (GST, TDS)', amount: 500 },
      { key: 'drawings', label: 'Owner drawings', amount: 2000 },
    ]);
    // Fields older clients read.
    expect(cf.summary.breakdown.incoming.receivable_payments).toBe(118);
    expect(cf.summary.breakdown.outgoing.payments_out).toBe(0);
    expect(cf.summary.breakdown.outgoing.expenses).toBe(3000);
  });

  it('ignores movements outside the fiscal year', () => {
    const out = buildDashboardCashFlow({
      startYear: 2026,
      opening: 0,
      movements: [move('2027-04', 'in', 99, counter('3001', 'capital'))],
    });
    expect(out.summary.total_incoming).toBe(0);
    expect(out.summary.closing_balance).toBe(0);
  });
});
