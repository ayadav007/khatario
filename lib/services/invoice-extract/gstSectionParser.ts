/**
 * Public API for GST **section band** discovery on OCR lines.
 * Delegates rate parsing to `gstHeaderParser` and multi-line logic to
 * `assignSectionGstRates` (propagation engine) for consistent behaviour.
 */

import { assignSectionGstRates } from './gstPropagationEngine';
import { parseHeaderGstRate } from './gstHeaderParser';
import { inferPageHeightFromOcrLines } from './ocrLayoutService';
import type { OcrLine } from './ocrLineTypes';

export interface GstSectionMarker {
  /** 0-based index in the ordered line list where this header appears */
  lineIndex: number;
  rawText: string;
  /** Full GST % (e.g. 5 for 2.5+2.5, 18 for 9+9) — snapped to nearest legal slab upstream */
  gstRate: number;
}

/**
 * True when the line **might** be a slab header (text gate only).
 * For acceptance, use `assignSectionGstRates` + confidence scores in the pipeline.
 */
export function isGstSectionHeaderLine(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 140) return false;
  return parseHeaderGstRate(t) != null;
}

/** @deprecated Prefer `parseHeaderGstRate` — kept for stable imports */
export function parseGstRateFromSectionHeaderLine(text: string): number | null {
  return parseHeaderGstRate(text);
}

/**
 * Scan ordered OCR lines and record every **accepted** GST section header with its rate.
 * Lines may be text-only; synthetic Y positions are assigned when missing so footer % works.
 */
export function detectGstSections(
  lines: Array<{ text: string; x?: number; y?: number; width?: number; height?: number }>
): GstSectionMarker[] {
  const ocr: OcrLine[] = lines.map((l, i) => ({
    text: l.text,
    x: l.x ?? 0,
    y: l.y ?? i * 16,
    width: l.width,
    height: l.height,
    kind: 'noise',
  }));
  const ph = inferPageHeightFromOcrLines(ocr);
  const { trace } = assignSectionGstRates(ocr, { pageHeight: ph });
  return trace.detectedHeaders.map((h) => ({
    lineIndex: h.lineIndex,
    rawText: lines[h.lineIndex]?.text ?? h.text,
    gstRate: h.rate,
  }));
}
