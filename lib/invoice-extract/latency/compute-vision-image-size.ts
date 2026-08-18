import { INVOICE_VISION_MAX_LONG_SIDE } from '@/lib/invoice-extract/latency/constants';

export interface InvoiceVisionTargetSize {
  width: number;
  height: number;
  scale: number;
  resized: boolean;
}

/**
 * Fit inside `maxLongSide` without upscaling. Deterministic integer rounding.
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
  if (longSide <= cap) {
    return { width: w, height: h, scale: 1, resized: false };
  }
  const scale = cap / longSide;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
    resized: true,
  };
}
