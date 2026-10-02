/**
 * Value for an `<input type="date">` from an API date. Postgres DATE columns reach the client as
 * ISO timestamps of the server's midnight, so take the calendar day in the browser's timezone
 * rather than slicing the UTC string (which lands on the previous day in IST).
 */
export function toDateInputValue(value: unknown): string {
  if (!value) return '';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
