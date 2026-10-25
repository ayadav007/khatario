import {
  INVOICE_VISION_MAX_LONG_SIDE,
  INVOICE_VISION_MIN_SHORT_SIDE,
  INVOICE_VISION_TALL_MAX_LONG_SIDE,
} from '@/lib/invoice-extract/latency/constants';

export interface InvoiceVisionTargetSize {
  width: number;
  height: number;
  scale: number;
  resized: boolean;
}

/**
 * Fit inside `maxLongSide` without upscaling. Deterministic integer rounding.
 * A long narrow image (till roll) may go past `maxLongSide` so its short side stays at
 * `INVOICE_VISION_MIN_SHORT_SIDE`, never past `INVOICE_VISION_TALL_MAX_LONG_SIDE`.
 */
export function computeInvoiceVisionTargetSize(
  width: number,
  height: number,
  maxLongSide: number = INVOICE_VISION_MAX_LONG_SIDE,
): InvoiceVisionTargetSize {
  const w = Number.isFinite(width) ? Math.max(1, Math.round(width)) : 1;
  const h = Number.isFinite(height) ? Math.max(1, Math.round(height)) : 1;
  const cap = Number.isFinite(maxLongSide) && maxLongSide > 0 ? maxLongSide : INVOICE_VISION_MAX_LONG_SIDE;
  const longSide = Math.max(w, h);
  const shortSide = Math.min(w, h);
  const tallCap = Math.max(cap, INVOICE_VISION_TALL_MAX_LONG_SIDE);
  const scale = Math.min(
    1,
    Math.max(cap / longSide, Math.min(INVOICE_VISION_MIN_SHORT_SIDE / shortSide, tallCap / longSide)),
  );
  if (scale >= 1) {
    return { width: w, height: h, scale: 1, resized: false };
  }
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
    resized: true,
  };
}
