/**
 * Deterministic OCR numeric repair candidate generation.
 * No LLMs — digit confusion pairs, decimal shifts, and small rounding fixes for thermal / retail OCR.
 */

/** Which column semantics we assume when expanding repair search space. */
export type OcrNumericFieldKind =
  | 'quantity'
  | 'currency_rate'
  | 'money_amount'
  | 'gst_percent';

/**
 * Common thermal / dot-matrix OCR confusions (digit → alternatives including self).
 * Keep symmetric where it matters; always include identity so callers can dedupe.
 */
export const OCR_DIGIT_CONFUSIONS: Readonly<Record<string, string[]>> = {
  '0': ['0', '6', '8'],
  '1': ['1', '7', '4'],
  '2': ['2', '7', '3'],
  '3': ['3', '8', '5'],
  '4': ['4', '1', '9'],
  '5': ['5', '6', '8', '3'],
  '6': ['6', '0', '5', '8'],
  '7': ['7', '1', '2'],
  '8': ['8', '0', '3', '9', '5'],
  '9': ['9', '8', '4'],
};

const MAX_CANDIDATES_PER_FIELD = 72;

function roundStable(n: number, decimals: number): number {
  const p = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * p) / p;
}

/**
 * Build absolute-value digit string with optional decimal point.
 * Uses enough precision to preserve grocery weights (e.g. 0.662).
 */
function numberToDigitString(absValue: number, maxFrac: number): string {
  if (!Number.isFinite(absValue)) return '';
  const s = absValue.toFixed(maxFrac);
  return s.replace(/\.?0+$/, (m) => (m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : ''));
}

/**
 * Apply one confusion substitution at a single digit index (char index in `digitStr`).
 * `digitStr` is the mantissa without sign (may include '.').
 */
function substituteAtIndex(digitStr: string, index: number, newCh: string): string | null {
  if (index < 0 || index >= digitStr.length) return null;
  const ch = digitStr[index];
  if (ch === '.') return null;
  const alts = OCR_DIGIT_CONFUSIONS[ch];
  if (!alts || !alts.includes(newCh)) return null;
  return digitStr.slice(0, index) + newCh + digitStr.slice(index + 1);
}

function parseDigitStringToNumber(neg: boolean, digitStr: string): number | null {
  const n = parseFloat(digitStr);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/**
 * Single-digit confusion variants (Hamming distance 1 on digit chars only).
 */
function singleDigitFlipVariants(absValue: number, maxFrac: number): number[] {
  const neg = absValue < 0;
  const a = Math.abs(absValue);
  const digitStr = numberToDigitString(a, maxFrac);
  if (!digitStr || !/\d/.test(digitStr)) return [];

  const out = new Set<number>();
  for (let i = 0; i < digitStr.length; i++) {
    const ch = digitStr[i];
    if (ch === '.') continue;
    const alts = OCR_DIGIT_CONFUSIONS[ch];
    if (!alts) continue;
    for (const repl of alts) {
      if (repl === ch) continue;
      const s = substituteAtIndex(digitStr, i, repl);
      if (!s) continue;
      const v = parseDigitStringToNumber(neg, s);
      if (v != null && Number.isFinite(v)) out.add(roundStable(v, maxFrac));
    }
  }
  return [...out];
}

/**
 * Decimal shift / missing-decimal heuristics common on thermal tapes.
 * Bounded so we do not explode search space.
 */
function decimalShiftVariants(value: number, kind: OcrNumericFieldKind): number[] {
  const out = new Set<number>();
  const v = Math.abs(value);
  if (!Number.isFinite(v) || v === 0) return [];

  const shifts =
    kind === 'quantity'
      ? [10, 100, 1000, 0.1, 0.01, 0.001]
      : kind === 'currency_rate'
        ? [10, 100, 0.1, 0.01]
        : kind === 'money_amount'
          ? [10, 100, 0.1, 0.01]
          : [0.1];

  for (const m of shifts) {
    const x = value * m;
    if (Number.isFinite(x) && Math.abs(x) < 1e12) {
      const frac = kind === 'quantity' ? 6 : kind === 'gst_percent' ? 4 : 4;
      out.add(roundStable(x, frac));
    }
  }
  return [...out];
}

/**
 * Last-digit / cent rounding repair for money (e.g. 79.4 vs 79.44 when OCR dropped last digit).
 */
function moneyRoundingNeighbors(value: number): number[] {
  const out = new Set<number>();
  if (!Number.isFinite(value)) return [];
  for (const delta of [0.01, 0.02, 0.03, 0.04, 0.05, -0.01, -0.02, -0.03, -0.04, -0.05]) {
    const x = roundStable(value + delta, 2);
    if (Number.isFinite(x)) out.add(x);
  }
  return [...out];
}

function fieldMaxFraction(kind: OcrNumericFieldKind): number {
  switch (kind) {
    case 'quantity':
      return 6;
    case 'currency_rate':
      return 4;
    case 'money_amount':
      return 2;
    case 'gst_percent':
      return 4;
    default:
      return 4;
  }
}

/**
 * Generate bounded deterministic repair candidates for a numeric OCR field.
 * Includes the original value, single-digit confusion neighbors, and a few decimal-shift probes.
 */
export function generateNumericRepairCandidates(
  value: number,
  kind: OcrNumericFieldKind
): number[] {
  if (!Number.isFinite(value)) return [];

  const maxFrac = fieldMaxFraction(kind);
  const out = new Set<number>();
  out.add(roundStable(value, maxFrac));

  for (const v of singleDigitFlipVariants(value, maxFrac)) {
    if (kind === 'gst_percent' && (v < 0 || v > 40)) continue;
    if (kind === 'quantity' && v <= 0) continue;
    if ((kind === 'currency_rate' || kind === 'money_amount') && v <= 0 && value > 0) continue;
    out.add(v);
  }

  for (const v of decimalShiftVariants(value, kind)) {
    if (kind === 'quantity' && v <= 0) continue;
    if ((kind === 'currency_rate' || kind === 'money_amount') && v <= 0 && value > 0) continue;
    out.add(roundStable(v, maxFrac));
  }

  if (kind === 'money_amount') {
    for (const v of moneyRoundingNeighbors(value)) out.add(v);
  }

  /** Prefer candidates numerically closer to the OCR read (stability). */
  const ranked = [...out].sort((a, b) => Math.abs(a - value) - Math.abs(b - value));
  return ranked.slice(0, MAX_CANDIDATES_PER_FIELD);
}
