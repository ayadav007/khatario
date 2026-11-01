/**
 * Store khata cycle maths (docs/plan/STORE_KHATA.md, section 2). Pure: dates are IST calendar
 * days as `YYYY-MM-DD` strings, so nothing here depends on the server time zone.
 *
 * Settlement day D is 1 to 28, or 0 for the last day of the month.
 * - D in 1..28: the cycle runs from D of last month to the day before D this month; the
 *   statement is made on D and covers that cycle.
 * - D = 0: the cycle is the calendar month; the statement is made on its last day.
 * A bill is due on its cycle's statement date and is overdue after that date plus the grace days.
 */

export const KHATA_LAST_DAY = 0;

type Ymd = { y: number; m: number; d: number };

function parse(date: string): Ymd {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function fmt(v: Ymd): string {
  return `${v.y}-${String(v.m).padStart(2, '0')}-${String(v.d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addMonths(y: number, m: number, n: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + n;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

export function addDays(date: string, n: number): string {
  const v = parse(date);
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d + n));
  return fmt({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

export function isValidSettlementDay(day: unknown): day is number {
  return typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 28;
}

function statementDayIn(y: number, m: number, day: number): string {
  return fmt({ y, m, d: day === KHATA_LAST_DAY ? daysInMonth(y, m) : day });
}

/** The statement date (= due date before grace) for a bill dated `date`. */
export function khataStatementDateFor(date: string, day: number): string {
  if (!isValidSettlementDay(day)) throw new Error(`Invalid settlement day: ${day}`);
  const v = parse(date);
  if (day === KHATA_LAST_DAY) return statementDayIn(v.y, v.m, day);
  if (v.d < day) return statementDayIn(v.y, v.m, day);
  const next = addMonths(v.y, v.m, 1);
  return statementDayIn(next.y, next.m, day);
}

/** True when `date` is the customer's statement day. */
export function isKhataStatementDay(date: string, day: number): boolean {
  if (!isValidSettlementDay(day)) return false;
  const v = parse(date);
  return statementDayIn(v.y, v.m, day) === fmt(v);
}

/** The bills a statement made on `statementDate` covers: [start, end], both inclusive. */
export function khataStatementPeriod(statementDate: string, day: number): { start: string; end: string } {
  const v = parse(statementDate);
  if (day === KHATA_LAST_DAY) {
    return { start: fmt({ y: v.y, m: v.m, d: 1 }), end: statementDate };
  }
  const prev = addMonths(v.y, v.m, -1);
  return { start: statementDayIn(prev.y, prev.m, day), end: addDays(statementDate, -1) };
}

/** Last day the bill can be paid before it counts as overdue. */
export function khataPayBy(dueDate: string, graceDays: number): string {
  return addDays(dueDate, Math.max(0, Math.floor(graceDays || 0)));
}

/** A bill due on `dueDate` is overdue on `today` once the grace days have passed. */
export function isKhataOverdue(dueDate: string, today: string, graceDays: number): boolean {
  return khataPayBy(dueDate, graceDays) < today;
}

/** "5 Nov" for messages and labels. */
export function khataShortDate(date: string): string {
  const v = parse(date);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][v.m - 1];
  return `${v.d} ${month}`;
}

/** "5th of every month" / "Last day of every month". */
export function khataSettlementDayLabel(day: number): string {
  if (day === KHATA_LAST_DAY) return 'Last day of every month';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = day % 100;
  const suffix = s[(v - 20) % 10] || s[v] || s[0];
  return `${day}${suffix} of every month`;
}
