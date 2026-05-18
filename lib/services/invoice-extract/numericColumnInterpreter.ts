/**
 * Deterministic numeric parsing for invoice table cells (Indian OCR quirks).
 */

const RE_HYPHEN_PAISE = /^(\d{1,6})-(\d{1,2})$/;
const RE_COMMA_DECIMAL = /^-?[\d,]+\.\d{1,4}$/;
const RE_PLAIN_INT = /^-?\d+$/;

/** Strip currency noise; keep digits, dot, comma, minus */
export function sanitizeNumericToken(raw: string): string {
  return raw
    .replace(/\u2212/g, '-')
    .replace(/[₹RsINR\s]/gi, '')
    .trim();
}

/**
 * Parse a single cell to a finite number when possible.
 * Supports `240-00`, commas, plain decimals.
 */
export function parseNumericCell(raw: string): number | undefined {
  const s = sanitizeNumericToken(raw);
  if (!s || !/\d/.test(s)) return undefined;

  const hy = s.match(RE_HYPHEN_PAISE);
  if (hy) {
    const whole = parseInt(hy[1], 10);
    const frac = parseInt(hy[2], 10);
    if (!Number.isFinite(whole) || !Number.isFinite(frac)) return undefined;
    return Math.round((whole + frac / 100) * 100) / 100;
  }

  const normalized = s.replace(/,/g, '');
  const v = parseFloat(normalized);
  if (!Number.isFinite(v)) return undefined;
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}

/** True if token is clearly numeric / money-shaped (not prose). */
export function isNumericLookingToken(raw: string): boolean {
  const p = parseNumericCell(raw);
  if (p != null && Math.abs(p) > 1e-9) return true;
  const t = sanitizeNumericToken(raw);
  return /^-?\d+[.,]\d+$/.test(t) || RE_HYPHEN_PAISE.test(t);
}

/** Weight-style qty e.g. `0.942` kg */
export function parseQuantityCell(raw: string): number | undefined {
  const v = parseNumericCell(raw);
  if (v == null) return undefined;
  if (v >= 0 && v <= 1_000_000) return v;
  return undefined;
}
