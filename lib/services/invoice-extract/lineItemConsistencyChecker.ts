/**
 * Line-level deterministic checks: qty × rate (+ GST / discount semantics) vs printed line total.
 * Used by the numeric reconciliation engine — no LLM.
 *
 * Does not import `indian-gst-invoice-extract` (same module graph as the engine).
 */

import { inclusiveLineTotalWithDiscountAmount } from '@/lib/invoice-line-math';

/** Header-level price interpretation (matches `IndianGstInvoiceExtract.price_mode`). */
export type LineCheckerPriceMode = 'exclusive' | 'inclusive';

export interface LineAmountConsistencyContext {
  qty: number;
  rate: number;
  /** Tax-inclusive line total as extracted (anchor). */
  lineTotal: number;
  gstRatePercent: number;
  discountAmount: number;
  discountOnTaxInclusive: boolean;
  headerPriceMode: LineCheckerPriceMode;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Expected tax-inclusive line total from qty, exclusive unit rate, discount, and GST rules
 * aligned with `normalizeIndianGstInvoiceExtract` / purchase calculator conventions.
 */
export function expectedInclusiveLineTotal(ctx: LineAmountConsistencyContext): number {
  const q = Math.max(0, ctx.qty);
  const up = ctx.rate;
  const da = Math.max(0, ctx.discountAmount);
  const t = Math.max(0, ctx.gstRatePercent);
  if (q <= 0) return 0;
  if (up < 0 && t <= 0) return round2(q * up);

  const discOffInc =
    ctx.discountOnTaxInclusive ||
    (ctx.headerPriceMode === 'inclusive' && da > 0 && t > 0);

  if (da > 0) {
    return round2(
      inclusiveLineTotalWithDiscountAmount(q, up, da, t, discOffInc)
    );
  }
  const gross = q * up;
  if (t <= 0) return round2(gross);
  if (ctx.headerPriceMode === 'inclusive') {
    return round2(gross);
  }
  return round2(gross * (1 + t / 100));
}

/**
 * Absolute error between model-implied inclusive total and extracted line total.
 */
export function lineInclusiveTotalError(ctx: LineAmountConsistencyContext): number {
  const exp = expectedInclusiveLineTotal(ctx);
  return Math.abs(exp - ctx.lineTotal);
}

/**
 * Tolerance: slightly looser for large lines; floor for tiny thermal totals.
 * `relative` default 0.008 (~0.8%) matches noisy thermal rounding.
 */
export function defaultLineTotalTolerance(
  lineTotal: number,
  opts?: { relative?: number; floor?: number }
): number {
  const rel = opts?.relative ?? 0.008;
  const floor = opts?.floor ?? 0.05;
  return Math.max(floor, Math.abs(lineTotal) * rel);
}
