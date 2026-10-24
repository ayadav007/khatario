/**
 * Batch and expiry for stock entered while adding an item (Scan & Add Items, photo 2).
 * Saved as an item_batches row, and the item is switched to batch tracking with FIFO so sales
 * draw down the oldest batch first. Batch-level FIFO only; COGS still follows the business setting.
 */

export interface OpeningBatchInput {
  batch_number?: unknown;
  manufacturing_date?: unknown;
  expiry_date?: unknown;
}

export interface OpeningBatch {
  batchNumber: string;
  manufacturingDate: string | null;
  expiryDate: string | null;
}

/** Used when the pack shows a date but no batch code. */
export const DEFAULT_OPENING_BATCH_NUMBER = 'OPENING';

function day(v: unknown, endOfMonth: boolean): string | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null;
  const t = String(v).trim();
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(t);
  if (!m) return 'invalid';
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return 'invalid';
  if (m[3]) {
    const d = new Date(Date.UTC(year, month - 1, Number(m[3])));
    return d.getUTCMonth() === month - 1 ? t : 'invalid';
  }
  // A pack that prints only "EXP 03/2027" is good through the month; "MFD 09/2026" from its start.
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${endOfMonth ? String(last).padStart(2, '0') : '01'}`;
}

/** Null when nothing was given. An error message when a date is not a real date or expiry is before manufacture. */
export function normalizeOpeningBatch(input: OpeningBatchInput | null | undefined): OpeningBatch | null | { error: string } {
  if (!input || typeof input !== 'object') return null;
  const batch = typeof input.batch_number === 'string' ? input.batch_number.trim().slice(0, 100) : '';
  const mfg = day(input.manufacturing_date, false);
  const exp = day(input.expiry_date, true);
  if (mfg === 'invalid' || exp === 'invalid') return { error: 'Batch dates must be YYYY-MM-DD or YYYY-MM' };
  if (!batch && !mfg && !exp) return null;
  if (mfg && exp && exp < mfg) return { error: 'Expiry date is before the manufacturing date' };
  return { batchNumber: batch || DEFAULT_OPENING_BATCH_NUMBER, manufacturingDate: mfg, expiryDate: exp };
}
