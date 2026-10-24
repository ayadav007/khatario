/** Pure wage amounts. Daily half-day is half the rate. Monthly salary is the month amount. */

export type PayBasis = 'daily' | 'monthly';
export type WagePeriodKind = 'week' | 'month';

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseYmd(ymd: string): Date {
  return new Date(`${ymd.slice(0, 10)}T12:00:00`);
}

export function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function shiftYmd(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + days);
  return formatYmd(d);
}

/** Monday–Sunday week containing ymd. */
export function weekBounds(ymd: string): { start: string; end: string } {
  const d = parseYmd(ymd);
  const weekday = d.getDay(); // 0 Sun
  const fromMonday = weekday === 0 ? -6 : 1 - weekday;
  const start = parseYmd(ymd);
  start.setDate(d.getDate() + fromMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: formatYmd(start), end: formatYmd(end) };
}

export function monthBounds(ymd: string): { start: string; end: string } {
  const d = parseYmd(ymd);
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 12);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
  return { start: formatYmd(start), end: formatYmd(end) };
}

export function periodBounds(kind: WagePeriodKind, ymd: string): { start: string; end: string } {
  return kind === 'week' ? weekBounds(ymd) : monthBounds(ymd);
}

/**
 * Amount earned for a closed period.
 * Daily: present days plus half-days at half rate. Off, absent, and unmarked days pay nothing.
 * Monthly: the monthly salary when the period is a month. A week does not accrue monthly staff.
 */
export function earnedAmount(input: {
  payBasis: PayBasis;
  rate: number;
  periodKind: WagePeriodKind;
  presentDays: number;
  halfDays: number;
}): number {
  const rate = round2(Number(input.rate) || 0);
  if (!(rate > 0)) return 0;
  if (input.payBasis === 'monthly') {
    return input.periodKind === 'month' ? rate : 0;
  }
  const days = Number(input.presentDays) + Number(input.halfDays) * 0.5;
  return round2(days * rate);
}

export type SalaryBooksSplit = {
  expense: number;
  payableDebit: number;
  cash: number;
  tds: number;
  pf: number;
  esi: number;
  professionalTax: number;
  advanceOnBooks: number;
  withheld: number;
};

/** How a salary payment splits onto the ledger. `earned` is gross minus unpaid-absence deduction. */
export function splitSalaryPaymentBooks(input: {
  earned: number;
  net: number;
  tds: number;
  pf: number;
  esi: number;
  professionalTax: number;
  advanceRecovery: number;
  advanceOnBooks: number;
  loan: number;
  otherDeductions: number;
  accrualOutstanding: number;
}): SalaryBooksSplit {
  const earned = round2(Math.max(0, input.earned));
  const net = round2(Math.max(0, input.net));
  const tds = round2(Math.max(0, input.tds));
  const pf = round2(Math.max(0, input.pf));
  const esi = round2(Math.max(0, input.esi));
  const professionalTax = round2(Math.max(0, input.professionalTax));
  const advanceOnBooks = round2(
    Math.min(Math.max(0, input.advanceRecovery), Math.max(0, input.advanceOnBooks)),
  );
  const payableDebit = round2(Math.min(earned, Math.max(0, input.accrualOutstanding)));
  const expense = round2(earned - payableDebit);
  const explained =
    net + tds + pf + esi + professionalTax + advanceOnBooks;
  const withheld = round2(Math.max(0, earned - explained));
  return {
    expense,
    payableDebit,
    cash: net,
    tds,
    pf,
    esi,
    professionalTax,
    advanceOnBooks,
    withheld,
  };
}
