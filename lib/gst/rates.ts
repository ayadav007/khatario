/**
 * GST rate slabs from 22 September 2025 (combined CGST + SGST, or IGST).
 * 0.1 (merchant exports), 0.25 (rough diamonds), 1.5 and 3 (jewellery / precious metals) are special rates.
 * 28 survives only for tobacco and pan masala while compensation cess continues.
 * Compensation cess is separate and entered per line.
 */
export const GST_RATE_SLABS = [0, 0.1, 0.25, 1.5, 3, 5, 18, 40] as const;
const TRANSITIONAL_RATES = [28] as const;
/** Documents dated before the rationalisation may still carry the old 12% and 28% slabs. */
const PRE_2025_RATES = [1, 12, 28] as const;
export const GST_RATIONALISATION_DATE = '2025-09-22';

function toNumber(rate: unknown): number | null {
  const n = typeof rate === 'string' && rate.trim() !== '' ? Number(rate) : rate;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function inList(n: number, list: readonly number[]): boolean {
  return list.some((r) => Math.abs(r - n) < 0.0001);
}

export function isAllowedGstRate(rate: unknown, documentDate?: string | null): boolean {
  const n = toNumber(rate);
  if (n === null) return false;
  if (inList(n, GST_RATE_SLABS) || inList(n, TRANSITIONAL_RATES)) return true;
  const day = documentDate ? String(documentDate).slice(0, 10) : null;
  return !!day && day < GST_RATIONALISATION_DATE && inList(n, PRE_2025_RATES);
}

export function gstRateError(rate: unknown, documentDate?: string | null): string | null {
  if (rate === null || rate === undefined || rate === '') return null;
  if (isAllowedGstRate(rate, documentDate)) return null;
  return `GST rate ${rate}% is not a notified slab. Use one of ${GST_RATE_SLABS.join(', ')}% (28% only for cess goods).`;
}

export function isValidCessRate(rate: unknown): boolean {
  if (rate === null || rate === undefined || rate === '') return true;
  const n = toNumber(rate);
  return n !== null && n >= 0 && n <= 290;
}
