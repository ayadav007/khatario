/**
 * OCR-tolerant GST **section band** header parsing (no LLM).
 * Tolerates missing %, extra spaces, OCR glue, and alternate punctuation.
 */

import { nearestGstRate } from '@/lib/indian-gst-invoice-extract';

/** Primary: CGST … digits … SGST … digits (commas, %, colons allowed between halves) */
const RE_CGST_SGST_PAIR =
  /CGST[^0-9]*([\d.]+)[^0-9]{0,32}SGST[^0-9]*([\d.]+)/i;

/** IGST with optional separators before digits */
const RE_IGST = /IGST[^0-9]*([\d.]+)\s*%?/i;

/** Plain "GST" rate (avoid matching "GSTIN") — require word GST not followed by IN */
const RE_GST_PLAIN = /\bGST(?!\s*IN\b)[^0-9]*([\d.]+)\s*%?/i;

const RE_SLAB = /\bSLAB[^0-9]*([\d.]+)\s*%?/i;

/** Numbered retail band: `2) CGST @ …` */
const RE_NUMBERED_SECTION = /^\s*(\d+)\s*\)\s*.{0,80}CGST/i;

/** When rupee amounts sit between halves (footer), require `%` anchors on each half */
const RE_CGST_SGST_PAIR_PCT_GAP = /CGST[\s.:@%]*([\d.]+)\s*%[\s\d.,]{0,56}?SGST[\s.:@%]*([\d.]+)\s*%/i;

export interface ParsedCgstSgst {
  cgst: number;
  sgst: number;
  /** cgst + sgst before nearestGstRate */
  combinedRaw: number;
}

/**
 * Extract CGST% and SGST% halves from noisy OCR text.
 */
export function tryParseCgstSgstHalves(text: string): ParsedCgstSgst | null {
  const t = text.replace(/\s+/g, ' ').trim();
  let m = t.match(RE_CGST_SGST_PAIR);
  if (!m) m = t.match(RE_CGST_SGST_PAIR_PCT_GAP);
  if (!m) return null;
  const cgst = parseFloat(m[1]);
  const sgst = parseFloat(m[2]);
  if (!Number.isFinite(cgst) || !Number.isFinite(sgst)) return null;
  if (cgst < 0 || sgst < 0) return null;
  /** Sanity: each half should not exceed 20% on real invoices */
  if (cgst > 25 || sgst > 25) return null;
  return { cgst, sgst, combinedRaw: cgst + sgst };
}

export function tryParseIgstPercent(text: string): number | null {
  const m = text.match(RE_IGST);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v) || v < 0 || v > 40) return null;
  return nearestGstRate(v);
}

export function tryParseGstPlainPercent(text: string): number | null {
  const m = text.match(RE_GST_PLAIN);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v) || v < 0 || v > 40) return null;
  return nearestGstRate(v);
}

export function tryParseSlabPercent(text: string): number | null {
  const m = text.match(RE_SLAB);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v) || v < 0 || v > 40) return null;
  return nearestGstRate(v);
}

/**
 * Single best full GST % for a line (CGST+SGST combined, or IGST, or GST/SLAB).
 * Order: CGST+SGST pair → IGST → SLAB → plain GST.
 */
export function parseHeaderGstRate(text: string): number | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const pair = tryParseCgstSgstHalves(t);
  if (pair) {
    return nearestGstRate(pair.combinedRaw);
  }

  const ig = tryParseIgstPercent(t);
  if (ig != null) return ig;

  const slab = tryParseSlabPercent(t);
  if (slab != null) return slab;

  const plain = tryParseGstPlainPercent(t);
  if (plain != null) return plain;

  return null;
}

export function hasNumberedSectionPrefix(text: string): boolean {
  return RE_NUMBERED_SECTION.test(text);
}
