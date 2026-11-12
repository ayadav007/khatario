// Pure date rules and change arithmetic for the Profit & Loss Compare tab.
// No imports: this file is used by server code, the API route and the client page.

export type CompareMode = 'previous_period' | 'previous_year' | 'custom';
export interface Period { from: string; to: string } // YYYY-MM-DD
export interface Change { amount: number; percent: number | null }

export class CompareInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompareInputError';
    Object.setPrototypeOf(this, CompareInputError.prototype);
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MS_PER_DAY = 86_400_000;

interface Ymd { y: number; m: number; d: number } // m is 1-12

function parts(s: string): Ymd {
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) };
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

function fmt(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isMonthStart(p: Ymd): boolean {
  return p.d === 1;
}

function isMonthEnd(p: Ymd): boolean {
  return p.d === daysInMonth(p.y, p.m);
}

function dayNumber(p: Ymd): number {
  return Math.round(Date.UTC(p.y, p.m - 1, p.d) / MS_PER_DAY);
}

function fromDayNumber(n: number): string {
  const dt = new Date(n * MS_PER_DAY);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Moves a (year, month) by a number of months (negative = back), returning year and month 1-12. */
function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (((idx % 12) + 12) % 12) + 1 };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const { y, m, d } = parts(v);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

/** A real date in or after the year 1900: what the report accepts. */
export function isReportDate(v: unknown): v is string {
  return isIsoDate(v) && parts(v).y >= 1900;
}

export function previousPeriod(p: Period): Period {
  const f = parts(p.from);
  const t = parts(p.to);
  if (isMonthStart(f) && isMonthEnd(t)) {
    const span = (t.y - f.y) * 12 + (t.m - f.m) + 1;
    const nf = shiftMonth(f.y, f.m, -span);
    const nt = shiftMonth(t.y, t.m, -span);
    return { from: fmt(nf.y, nf.m, 1), to: fmt(nt.y, nt.m, daysInMonth(nt.y, nt.m)) };
  }
  const fromN = dayNumber(f);
  const length = dayNumber(t) - fromN + 1;
  return { from: fromDayNumber(fromN - length), to: fromDayNumber(fromN - 1) };
}

function yearBack(s: string): string {
  const p = parts(s);
  const y = p.y - 1;
  const d = isMonthEnd(p) ? daysInMonth(y, p.m) : p.d;
  return fmt(y, p.m, d);
}

export function samePeriodLastYear(p: Period): Period {
  return { from: yearBack(p.from), to: yearBack(p.to) };
}

export function comparisonPeriods(base: Period, mode: CompareMode, count: number, custom?: Period | null): Period[] {
  if (mode === 'custom') return custom ? [custom] : [];
  const step = mode === 'previous_period' ? previousPeriod : samePeriodLastYear;
  const out: Period[] = [];
  let current = base;
  for (let i = 0; i < count; i++) {
    current = step(current);
    out.push(current);
  }
  return out;
}

const MODES: readonly string[] = ['previous_period', 'previous_year', 'custom'];

export function parseCompareRequest(q: {
  from_date: string; to_date: string;
  compare: string | null; count: string | null;
  compare_from: string | null; compare_to: string | null;
}): { mode: CompareMode; periods: Period[] } {
  const badFormat = () => new CompareInputError('Dates must be in YYYY-MM-DD format.');
  const badOrder = () => new CompareInputError('From date cannot be after To date.');
  const tooEarly = () => new CompareInputError('Dates must be in or after the year 1900.');
  const checkPeriods = (periods: Period[]) => {
    if (periods.some((p) => !isReportDate(p.from) || !isReportDate(p.to))) throw tooEarly();
    return periods;
  };

  if (!isIsoDate(q.from_date) || !isIsoDate(q.to_date)) throw badFormat();
  if (q.from_date > q.to_date) throw badOrder();
  if (!isReportDate(q.from_date) || !isReportDate(q.to_date)) throw tooEarly();
  const base: Period = { from: q.from_date, to: q.to_date };

  const compare = q.compare == null || q.compare === '' ? 'previous_period' : q.compare;
  if (!MODES.includes(compare)) {
    throw new CompareInputError('Compare with must be previous_period, previous_year or custom.');
  }
  const mode = compare as CompareMode;

  if (mode === 'custom') {
    const cf = q.compare_from == null || q.compare_from === '' ? null : q.compare_from;
    const ct = q.compare_to == null || q.compare_to === '' ? null : q.compare_to;
    if ((cf !== null && !isIsoDate(cf)) || (ct !== null && !isIsoDate(ct))) throw badFormat();
    if (cf === null || ct === null) throw new CompareInputError('A custom comparison needs both dates.');
    if (cf > ct) throw badOrder();
    if (!isReportDate(cf) || !isReportDate(ct)) throw tooEarly();
    return { mode, periods: [base, ...comparisonPeriods(base, mode, 1, { from: cf, to: ct })] };
  }

  const countStr = q.count == null || q.count === '' ? '1' : q.count;
  if (countStr !== '1' && countStr !== '2' && countStr !== '3') {
    throw new CompareInputError('Number of periods must be 1, 2 or 3.');
  }
  return { mode, periods: [base, ...checkPeriods(comparisonPeriods(base, mode, Number(countStr)))] };
}

export function changeBetween(base: number, compared: number): Change {
  const amount = r2(base - compared) + 0; // + 0 turns -0 into 0
  if (Math.abs(compared) < 0.005) return { amount, percent: null };
  const percent = r1((amount / Math.abs(compared)) * 100) + 0;
  return { amount, percent };
}

function label(s: string): string {
  const { y, m, d } = parts(s);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function periodLabel(p: Period): string {
  return `${label(p.from)} – ${label(p.to)}`;
}
