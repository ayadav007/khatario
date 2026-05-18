/**
 * Reconstructs logical reading-order lines from Google Vision `fullTextAnnotation`
 * using bounding boxes (Y-then-X sort). Used for deterministic GST section grouping.
 */

import type { FullTextAnnotation, VisionVertex, VisionWord } from './vision-types';
import type { OcrLine, OcrLineKind } from './ocrLineTypes';
import { looksLikeTotalsOrGrandLine } from './invoiceRegionDetector';

export type { OcrLine, OcrLineKind, OcrLogicalLine } from './ocrLineTypes';

export interface OcrWordBox {
  text: string;
  minY: number;
  minX: number;
  maxY: number;
  maxX: number;
}

function vertexBounds(vertices: VisionVertex[] | undefined): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (!vertices?.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function wordText(w: VisionWord): string {
  const syms = w.symbols;
  if (!syms?.length) return '';
  return syms.map((s) => s.text ?? '').join('');
}

function wordBox(w: VisionWord): OcrWordBox | null {
  const t = wordText(w);
  if (!t.trim()) return null;
  const bb = w.boundingBox?.vertices;
  if (bb?.length) {
    const { minX, minY, maxX, maxY } = vertexBounds(bb);
    return { text: t, minX, minY, maxX, maxY };
  }
  const syms = w.symbols ?? [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of syms) {
    const v = s.boundingBox?.vertices;
    if (!v?.length) continue;
    const b = vertexBounds(v);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (!Number.isFinite(minX)) return null;
  return { text: t, minX, minY, maxX, maxY };
}

function collectWordBoxes(annotation: FullTextAnnotation): OcrWordBox[] {
  const out: OcrWordBox[] = [];
  const pages = annotation.pages ?? [];
  for (const page of pages) {
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const word of para.words ?? []) {
          const b = wordBox(word);
          if (b) out.push(b);
        }
      }
    }
  }
  return out;
}

/** Heuristic median height of words for line clustering tolerance */
function medianWordHeight(boxes: OcrWordBox[]): number {
  const hs = boxes.map((b) => Math.max(1, b.maxY - b.minY)).sort((a, c) => a - c);
  if (!hs.length) return 10;
  return hs[Math.floor(hs.length / 2)] || 10;
}

/** Infer page height from Vision page meta or max word Y */
export function inferPageHeightFromAnnotation(
  fullTextAnnotation: FullTextAnnotation | null | undefined,
  wordBoxes: OcrWordBox[]
): number {
  const ph = fullTextAnnotation?.pages?.[0]?.height;
  if (ph != null && Number.isFinite(ph) && ph > 0) return ph;
  if (!wordBoxes.length) return 1;
  const maxY = Math.max(...wordBoxes.map((w) => w.maxY));
  return Math.max(1, maxY + 24);
}

/** When Vision `page.height` is unavailable, derive a stable page height from line bounds (footer %). */
export function inferPageHeightFromOcrLines(lines: OcrLine[]): number {
  if (!lines.length) return 1;
  const maxExtent = Math.max(...lines.map((l) => l.y + (l.height ?? 0)));
  return Math.max(1, maxExtent + 32);
}

/**
 * Group word boxes into horizontal lines, then sort lines top-to-bottom and words left-to-right.
 * Each line includes width/height for region + footer heuristics.
 */
export function reconstructOcrLines(fullTextAnnotation: FullTextAnnotation | null | undefined): OcrLine[] {
  if (!fullTextAnnotation?.pages?.length) return [];

  const boxes = collectWordBoxes(fullTextAnnotation);
  if (!boxes.length) return [];

  const pageH = inferPageHeightFromAnnotation(fullTextAnnotation, boxes);
  const tol = Math.max(8, medianWordHeight(boxes) * 0.45);

  const rows: OcrWordBox[][] = [];
  const sortedByY = [...boxes].sort((a, b) => a.minY - b.minY || a.minX - b.minX);

  for (const b of sortedByY) {
    let placed = false;
    for (const row of rows) {
      const ref = row[0];
      const rowMidY = (ref.minY + ref.maxY) / 2;
      const midY = (b.minY + b.maxY) / 2;
      if (Math.abs(midY - rowMidY) <= tol) {
        row.push(b);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([b]);
  }

  for (const row of rows) {
    row.sort((a, c) => a.minX - c.minX);
  }

  rows.sort((a, c) => {
    const ay = Math.min(...a.map((w) => w.minY));
    const cy = Math.min(...c.map((w) => w.minY));
    return ay - cy;
  });

  const lines: OcrLine[] = [];
  for (const row of rows) {
    const text = row
      .map((w) => w.text.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const minY = Math.min(...row.map((w) => w.minY));
    const minX = Math.min(...row.map((w) => w.minX));
    const maxY = Math.max(...row.map((w) => w.maxY));
    const maxX = Math.max(...row.map((w) => w.maxX));
    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);
    lines.push({
      text,
      y: minY,
      x: minX,
      width,
      height,
      pageNormY: pageH > 0 ? minY / pageH : undefined,
      kind: classifyOcrLineKind(text),
    });
  }

  return lines;
}

/** Quick text-only classifier (geometry-free). Refined later by GST header scorer. */
export function classifyOcrLineKind(text: string): OcrLineKind {
  const t = text.trim();
  if (!t) return 'blank';
  if (looksLikeGstKeywordLine(t)) return 'gst_header';
  if (isLikelyProductLine(t)) return 'item';
  return 'noise';
}

/** Loose keyword gate — final acceptance uses scoreGstHeaderLikelihood in propagation */
function looksLikeGstKeywordLine(t: string): boolean {
  const u = t.toUpperCase();
  /**
   * Require IGST to be followed by a rate (e‑com table headers like "Taxable IGST Total"
   * must not match as slab headers).
   */
  if (/\bIGST\b/.test(u) && /\bIGST[^A-Z0-9]*[\d]/i.test(t)) return true;
  if (/\bCGST\b/.test(u) && /\bSGST\b/.test(u)) return true;
  if (/^\s*\d+\s*\)\s*.*\bCGST\b/i.test(t)) return true;
  if (/\bGST\b/.test(u) && /\d/.test(t)) return true;
  if (/\bSLAB\b/.test(u) && /\d/.test(t)) return true;
  return false;
}

/** Count `12,345.67` / `123.45` style money tokens (generic PDF / e‑invoice rows). */
function countMoneyLikeDecimals(text: string): number {
  const m = text.match(/\b(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\b/g);
  return m ? m.length : 0;
}

/** Exchange / wallet / loyalty lines are priced rows but GST rate is effectively 0. */
export function looksLikeExchangeOrAdjustmentRow(t: string): boolean {
  const u = t.toUpperCase();
  return (
    /\bEXCHANGE\b/.test(u) ||
    /\bADJUSTMENT\b/.test(u) ||
    /\bCREDIT\s+NOTE\b/.test(u) ||
    /\bWALLET\b/.test(u) ||
    /\bCASHBACK\b/.test(u) ||
    /\bLOYALTY\b/.test(u)
  );
}

/**
 * Heuristic product / line-item row: thermal HSN-first, weight-style tail, or **tabular**
 * money rows (Flipkart, Amazon PDFs, B2B tables) with several `xxxxx.xx` amounts.
 */
export function isLikelyProductRowText(t: string): boolean {
  const s = t.trim();
  if (s.length < 6) return false;

  if (looksLikeTotalsOrGrandLine(s)) return false;
  const u = s.toUpperCase();
  if (/^TOTAL\s+/i.test(s) || /^NET\s+AMOUNT/i.test(u)) return false;

  if (/^\d{4,10}\s+\S/.test(s)) return true;
  if (/\d+\.\d{3}\s+\d+\.\d{2}\s*$/.test(s)) return true;

  /** Section / column tax labels — never product rows (check before money-count heuristics). */
  if (/^\s*IGST\s*[:.]?\s*[\d.]+\s*%?\s*$/i.test(s)) return false;
  if (/^\s*(CGST|SGST)\s*[:.]?\s*[\d.]+\s*%?\s*$/i.test(s)) return false;
  if (/\bCGST\b.*\bSGST\b/i.test(s) && /%/.test(s)) return false;
  if (/^\s*\d+\s*\)\s*.*\bCGST\b/i.test(s)) return false;

  const nMoney = countMoneyLikeDecimals(s);

  if (nMoney >= 3 && s.length <= 420) return true;
  if (nMoney >= 2 && s.length <= 220 && /\d+\.\d{2}.*\d+\.\d{2}/.test(s)) return true;

  /** Handwritten / pre-printed forms: `240-00` paise style + serial `1 ) …` (Vision rarely has `.xx`). */
  const nHyPaise = (s.match(/\b\d{3,5}-\d{2}\b/g) || []).length;
  if (nHyPaise >= 1 && /\d+\s*\)/.test(s) && s.length <= 220 && !/^TOTAL\b/i.test(s)) return true;

  return false;
}

function isLikelyProductLine(t: string): boolean {
  return isLikelyProductRowText(t);
}
