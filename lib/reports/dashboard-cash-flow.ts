/**
 * Dashboard cash flow card: money in and out of the cash and bank ledgers, month by month.
 * Every movement comes from ledger lines, so the closing figure is the cash and bank balance
 * in the books. Each movement is named after the account on the other side of its voucher.
 */

import type { BsClass } from '@/lib/reports/balance-sheet';

export type CashCounterAccount = {
  code: string;
  name: string;
  type: string;
  bsClass: BsClass | null;
  /** Accounts Receivable or an account under it (set by the loader); such accounts have free codes. */
  receivable?: boolean;
};

export type CashMovement = {
  /** YYYY-MM */
  month: string;
  direction: 'in' | 'out';
  /** Always positive. */
  amount: number;
  /** Largest non-cash line on the other side of the voucher; null when there is none. */
  counter: CashCounterAccount | null;
};

export type CashFlowLine = { key: string; label: string; amount: number };

export type DashboardCashFlowMonth = {
  month: string;
  monthLabel: string;
  opening: number;
  incoming: number;
  outgoing: number;
  closing: number;
};

const IN_LABELS = {
  sales: 'Sales and customer receipts',
  capital: 'Capital added by owner',
  loans: 'Loans received',
  other: 'Other receipts',
} as const;

const OUT_LABELS = {
  purchases: 'Purchases and supplier payments',
  expenses: 'Expenses',
  salaries: 'Salaries and wages',
  taxes: 'Taxes paid (GST, TDS)',
  drawings: 'Owner drawings',
  loans: 'Loan repayments',
  assets: 'Assets bought',
  refunds: 'Refunds to customers',
  other: 'Other payments',
} as const;

type InKey = keyof typeof IN_LABELS;
type OutKey = keyof typeof OUT_LABELS;

/** GST input and electronic ledgers, TDS and advance tax, GST / TDS / TCS / income tax payable. */
const TAX = /^(111[0-7]|113[0-3]|2102|2103|2109|2117|215)/;
/** Salaries, staff welfare, salary / PF / ESI / professional tax payable, advances to employees. */
const SALARY = /^(5212|5214|211[3-6]|1119)/;
/** Receivables, advances from customers, unearned revenue. */
const CUSTOMER = /^(1103|2106|2107)/;
const isCustomerAccount = (a: CashCounterAccount) => a.receivable === true || CUSTOMER.test(a.code);
/** Payables and advances to suppliers. */
const SUPPLIER = /^(2101|1107)/;
const INVENTORY = /^(1104|116[0-2])/;

function isLongTermLiability(a: CashCounterAccount) {
  if (a.type !== 'liability') return false;
  return a.bsClass ? a.bsClass === 'long_term_liability' : a.code.startsWith('22');
}

function isLongTermAsset(a: CashCounterAccount) {
  if (a.type !== 'asset') return false;
  return a.bsClass ? a.bsClass === 'fixed_asset' || a.bsClass === 'investment' : /^1[23]/.test(a.code);
}

function inKey(a: CashCounterAccount | null): InKey {
  if (!a) return 'other';
  if (a.type === 'capital') return 'capital';
  if (isLongTermLiability(a)) return 'loans';
  if (a.type === 'income') return a.code.startsWith('42') ? 'other' : 'sales';
  if (isCustomerAccount(a) || INVENTORY.test(a.code)) return 'sales';
  return 'other';
}

function outKey(a: CashCounterAccount | null): OutKey {
  if (!a) return 'other';
  if (a.type === 'capital') return 'drawings';
  if (isLongTermLiability(a)) return 'loans';
  if (TAX.test(a.code)) return 'taxes';
  if (SALARY.test(a.code)) return 'salaries';
  if (SUPPLIER.test(a.code) || INVENTORY.test(a.code)) return 'purchases';
  if (a.type === 'expense') return a.code.startsWith('51') ? 'purchases' : 'expenses';
  if (isLongTermAsset(a)) return 'assets';
  if (isCustomerAccount(a)) return 'refunds';
  return 'other';
}

export function classifyCashMovement(
  direction: 'in' | 'out',
  counter: CashCounterAccount | null
): { key: string; label: string } {
  if (direction === 'in') {
    const key = inKey(counter);
    return { key, label: IN_LABELS[key] };
  }
  const key = outKey(counter);
  return { key, label: OUT_LABELS[key] };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function breakdownLines(labels: Record<string, string>, totals: Map<string, number>): CashFlowLine[] {
  return Object.keys(labels)
    .map((key) => ({ key, label: labels[key], amount: r2(totals.get(key) || 0) }))
    .filter((l) => l.amount !== 0);
}

/**
 * `startYear` is the year the fiscal year starts in (April). `opening` is the cash and bank
 * balance before 1 April, plus opening-balance vouchers.
 */
export function buildDashboardCashFlow(input: { startYear: number; opening: number; movements: CashMovement[] }) {
  const { startYear } = input;
  const opening = r2(input.opening);

  const byMonth = new Map<string, { incoming: number; outgoing: number }>();
  for (let i = 0; i < 12; i++) {
    const m = (3 + i) % 12;
    const y = startYear + (3 + i >= 12 ? 1 : 0);
    byMonth.set(`${y}-${String(m + 1).padStart(2, '0')}`, { incoming: 0, outgoing: 0 });
  }

  const inTotals = new Map<string, number>();
  const outTotals = new Map<string, number>();
  for (const mv of input.movements) {
    const bucket = byMonth.get(mv.month);
    if (!bucket) continue;
    const { key } = classifyCashMovement(mv.direction, mv.counter);
    if (mv.direction === 'in') {
      bucket.incoming += mv.amount;
      inTotals.set(key, (inTotals.get(key) || 0) + mv.amount);
    } else {
      bucket.outgoing += mv.amount;
      outTotals.set(key, (outTotals.get(key) || 0) + mv.amount);
    }
  }

  const months: DashboardCashFlowMonth[] = [];
  let running = opening;
  for (const [month, b] of byMonth) {
    const [y, m] = month.split('-').map(Number);
    const incoming = r2(b.incoming);
    const outgoing = r2(b.outgoing);
    const closing = r2(running + incoming - outgoing);
    months.push({ month, monthLabel: `${MONTHS[m - 1]} ${y}`, opening: running, incoming, outgoing, closing });
    running = closing;
  }

  const incomingLines = breakdownLines(IN_LABELS, inTotals);
  const outgoingLines = breakdownLines(OUT_LABELS, outTotals);
  const lineAmount = (lines: CashFlowLine[], key: string) => lines.find((l) => l.key === key)?.amount ?? 0;
  const paymentsOut = lineAmount(outgoingLines, 'purchases');

  return {
    fiscal_year: `${startYear}-${startYear + 1}`,
    months,
    chart_series: [
      {
        month: 'opening',
        monthLabel: `Opening (01 Apr ${startYear})`,
        opening,
        incoming: 0,
        outgoing: 0,
        closing: opening,
      },
      ...months,
    ],
    summary: {
      total_incoming: r2(months.reduce((s, m) => s + m.incoming, 0)),
      total_outgoing: r2(months.reduce((s, m) => s + m.outgoing, 0)),
      opening_balance: opening,
      closing_balance: running,
      opening_as_of: `${startYear}-03-31`,
      breakdown: {
        incoming: {
          lines: incomingLines,
          /** @deprecated use lines; kept for older clients */
          receivable_payments: lineAmount(incomingLines, 'sales'),
        },
        outgoing: {
          lines: outgoingLines,
          /** @deprecated use lines; kept for older clients */
          payments_out: paymentsOut,
          /** @deprecated use lines; kept for older clients */
          expenses: lineAmount(outgoingLines, 'expenses'),
          /** @deprecated use lines; kept for older clients */
          purchases: 0,
          /** @deprecated use lines; kept for older clients */
          other_payments: paymentsOut,
        },
      },
    },
  };
}

export type DashboardCashFlow = ReturnType<typeof buildDashboardCashFlow>;
