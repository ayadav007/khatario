/**
 * Canonical rounding helpers: money vs retail qty vs derived exclusive rates.
 */

function roundDecimals(n: number, decimals: number): number {
  if (!Number.isFinite(n)) return 0;
  const k = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * k) / k;
}

function parseNumeric(n: unknown): number {
  if (typeof n === 'number') {
    return Number.isFinite(n) ? n : NaN;
  }
  const parsed = parseFloat(String(n ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** ₹ totals, anchors, inclusive line totals, discounts in rupees — paise precision (2 dp). */
export function round2(n: unknown): number {
  const x = parseNumeric(n);
  if (!Number.isFinite(x)) return 0;
  return roundDecimals(x, 2);
}

/** POS / retail qty (kg, liter, pcs fraction). Coarser ₹ rounding destroys D‑mart‑style receipts. */
export function roundRetailQty(n: unknown): number {
  const x = parseNumeric(n);
  if (!Number.isFinite(x)) return 0;
  return roundDecimals(x, 4);
}

/**
 * Exclusive ₹/unit (pre‑GST); backing out from OCR inclusive lines needs more than paise‑only rounding.
 */
export function roundExclusiveUnitPrice(n: unknown): number {
  const x = parseNumeric(n);
  if (!Number.isFinite(x)) return 0;
  return roundDecimals(x, 6);
}
