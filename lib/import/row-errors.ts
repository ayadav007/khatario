/**
 * Turns a PostgreSQL error thrown while saving one row into a reason for that row, or null when
 * the error is not about the row. Only data exceptions (SQLSTATE class 22) and integrity
 * violations (class 23) belong to the row: they fail the same way on every retry. Connection,
 * resource and internal errors (08, 53, 57, XX, ...) return null so the run stops and resumes.
 */
type PgErrorFields = { code?: unknown; table?: unknown; constraint?: unknown; column?: unknown; detail?: unknown; message?: unknown };

const MAX_MESSAGE = 120;
const KEY_WORDS = new Set(['business_id', 'lower', 'upper', 'trim', 'both', 'from', 'coalesce', 'text', 'varchar']);

/** The first column in a unique violation's "Key (...)=" detail other than business_id. */
function keyColumn(detail: unknown): string | null {
  const m = typeof detail === 'string' ? detail.match(/^Key \((.*?)\)=/) : null;
  if (!m) return null;
  const word = (m[1].match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).find((w) => !KEY_WORDS.has(w.toLowerCase()));
  return word ? word.toLowerCase() : null;
}

const readable = (column: string) => column.replace(/_/g, ' ');

export function rowFailureReason(e: unknown): string | null {
  if (!e || typeof e !== 'object') return null;
  const err = e as PgErrorFields;
  const code = typeof err.code === 'string' ? err.code : '';
  if (!/^2[23][0-9A-Z]{3}$/.test(code)) return null;

  if (code === '23505') {
    if (err.table === 'items' && typeof err.constraint === 'string' && /barcode/i.test(err.constraint)) {
      return 'Barcode is already used by another item (it may be deleted).';
    }
    const column = keyColumn(err.detail);
    return `Already exists (duplicate ${column ? readable(column) : 'value'}).`;
  }
  if (code === '22001') {
    return typeof err.column === 'string' && err.column ? `${err.column} is too long.` : 'A value is too long.';
  }
  const first = typeof err.message === 'string' ? err.message.split('\n')[0].trim() : '';
  const short = first.length > MAX_MESSAGE ? `${first.slice(0, MAX_MESSAGE - 1)}…` : first;
  return `Could not be saved: ${short || 'the database refused this row'}`;
}
