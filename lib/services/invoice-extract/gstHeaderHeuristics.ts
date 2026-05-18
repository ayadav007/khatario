/**
 * Confidence scoring for GST section-band headers vs product/marketing/footer noise.
 * Deterministic only — no LLM.
 */

import { hasNumberedSectionPrefix, parseHeaderGstRate, tryParseCgstSgstHalves } from './gstHeaderParser';
import type { InvoiceRegions } from './invoiceRegionDetector';
import { isFooterRegion } from './invoiceRegionDetector';
import type { OcrLine } from './ocrLineTypes';

export interface GstHeaderScoreContext {
  pageHeight: number;
  regions: InvoiceRegions;
}

function countRupeeLikeAmounts(text: string): number {
  /** Strip GST % tokens so "2.50%" halves are not counted as rupee columns */
  const stripped = text.replace(/\b\d+(?:\.\d+)?\s*%/gi, ' ');
  const m = stripped.match(/\b\d{1,6}(?:\.\d{2})\b/g);
  return m ? m.length : 0;
}

function looksLikeQtyRateTotalRow(text: string): boolean {
  const t = text.trim();
  if (/\d+\.\d{3}\s+\d+\.\d{2}\s*$/.test(t)) return true;
  if (/\b\d{1,3}(?:\.\d{1,4})?\s+\d{1,4}(?:\.\d{1,4})?\s+\d{1,4}(?:\.\d{2})\s*$/.test(t)) return true;
  return false;
}

function looksLikeHsnLeadingProduct(text: string): boolean {
  return /^\d{4,10}\s+\S/.test(text.trim());
}

/**
 * Returns 0–1 confidence that this line is a **section slab header** (not product, not footer summary).
 */
export function scoreGstHeaderLikelihood(line: OcrLine, ctx: GstHeaderScoreContext): number {
  const t = line.text.replace(/\s+/g, ' ').trim();
  if (!t) return 0;

  const rate = parseHeaderGstRate(t);
  if (rate == null) return 0;

  let s = 0.32;

  if (tryParseCgstSgstHalves(t)) s += 0.18;
  if (hasNumberedSectionPrefix(t)) s += 0.14;

  /** Single-line IGST % (e‑com PDFs) — no CGST+SGST pair, else score stays too low vs threshold */
  if (/^\s*IGST\s*[:.]?\s*[\d.]+\s*%?\s*$/i.test(t)) s += 0.2;

  if (t.length < 120) s += 0.08;
  if (t.length < 72) s += 0.06;

  if (looksLikeHsnLeadingProduct(t)) s -= 0.45;
  if (looksLikeQtyRateTotalRow(t)) s -= 0.35;

  const u = t.toUpperCase();
  if (/\bOFFER\b|\bMRP\b|\bSAVE\b|\bFREE\b/.test(u)) s -= 0.25;

  const amtN = countRupeeLikeAmounts(t);
  if (amtN >= 2) s -= 0.22;
  if (amtN >= 3) s -= 0.15;

  if (isFooterRegion(line, ctx.pageHeight)) {
    s -= 0.55;
  }

  if (/\bGRAND\s+TOTAL\b|\bGST\s+SUMMARY\b|\bHSN\b.*\bTAX\b/i.test(u) && t.length < 100) {
    s -= 0.2;
  }

  const cy = line.y + (line.height ?? 0) / 2;
  const ir = ctx.regions.itemTableRegion;
  if (ir && cy >= ir.y0 && cy <= ir.y1) s += 0.06;

  return Math.max(0, Math.min(1, s));
}

export const DEFAULT_GST_HEADER_CONFIDENCE_THRESHOLD = 0.58;
