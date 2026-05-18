/**
 * Coarse invoice regions from OCR line geometry (thermal / POS receipts).
 * Used to suppress false GST "headers" in footer tax summaries.
 */

import type { OcrLine } from './ocrLineTypes';

/** Y-range on page (pixel space, same as Vision) */
export interface RectRegion {
  y0: number;
  y1: number;
  label: string;
}

export interface InvoiceRegions {
  headerRegion: RectRegion | null;
  itemTableRegion: RectRegion | null;
  taxSummaryRegion: RectRegion | null;
  totalsRegion: RectRegion | null;
  footerRegion: RectRegion | null;
}

const FOOTER_FRAC_DEFAULT = 0.2;

function lineCenterY(line: OcrLine): number {
  const h = line.height ?? 0;
  return line.y + h / 2;
}

/**
 * True when the line's vertical center lies in the footer band (default bottom 20% of page).
 */
export function isFooterRegion(line: OcrLine, pageHeight: number, footerFrac = FOOTER_FRAC_DEFAULT): boolean {
  if (!pageHeight || pageHeight <= 0) return false;
  const cy = lineCenterY(line);
  const y0 = pageHeight * (1 - footerFrac);
  return cy >= y0;
}

/**
 * Heuristic: line is part of printed totals / grand-total block.
 */
export function looksLikeTotalsOrGrandLine(text: string): boolean {
  const u = text.toUpperCase();
  if (/\bGRAND\s+TOTAL\b/.test(u)) return true;
  if (/\bNET\s+(AMOUNT|PAYABLE)\b/.test(u)) return true;
  if (/\bAMOUNT\s+PAYABLE\b/.test(u)) return true;
  if (/\bTOTAL\s+PAYABLE\b/.test(u)) return true;
  if (/\bSUB\s*TOTAL\b/.test(u)) return true;
  if (/\bTAXABLE\s+VALUE\b/.test(u) && u.length < 80) return true;
  return false;
}

/**
 * Strong end-of-document signal: after this, slab-style GST lines are almost always
 * footer summaries — do not treat them as new section headers.
 */
export function looksLikeGrandTotalAnchorLine(text: string): boolean {
  const u = text.toUpperCase();
  if (/\bGRAND\s+TOTAL\b/.test(u)) return true;
  if (/\bNET\s+PAYABLE\b/.test(u)) return true;
  if (/\bAMOUNT\s+PAYABLE\b/.test(u)) return true;
  if (/\bTOTAL\s+PAYABLE\b/.test(u)) return true;
  return false;
}

/**
 * Infer coarse regions. Without a dedicated layout model this is heuristic:
 * - footerRegion: bottom `footerFrac` of page
 * - totalsRegion: lines matching totals keywords until footer start
 * - headerRegion: top slice until first strong item signal (optional)
 */
export function detectInvoiceRegionsFromOcrLines(
  lines: OcrLine[],
  pageHeight: number,
  footerFrac = FOOTER_FRAC_DEFAULT
): InvoiceRegions {
  const ph = pageHeight > 0 ? pageHeight : 1;
  const yFooter = ph * (1 - footerFrac);

  const footerRegion: RectRegion = {
    y0: yFooter,
    y1: ph,
    label: 'footer',
  };

  let totalsY0 = yFooter;
  for (const ln of lines) {
    if (looksLikeTotalsOrGrandLine(ln.text) && lineCenterY(ln) < yFooter) {
      totalsY0 = Math.min(totalsY0, ln.y);
    }
  }

  const totalsRegion: RectRegion | null =
    totalsY0 < yFooter - 5
      ? { y0: totalsY0, y1: yFooter, label: 'totals' }
      : null;

  /** Header: top 12% or until first line with HSN-like product prefix */
  let headerEnd = ph * 0.12;
  for (const ln of lines) {
    if (/^\d{4,10}\s+\S/.test(ln.text.trim())) {
      headerEnd = Math.min(headerEnd, ln.y);
      break;
    }
  }

  const headerRegion: RectRegion = { y0: 0, y1: Math.max(24, headerEnd), label: 'header' };

  const itemTableRegion: RectRegion = {
    y0: headerRegion.y1,
    y1: totalsRegion ? totalsRegion.y0 : yFooter,
    label: 'item_table',
  };

  const taxSummaryRegion: RectRegion | null =
    totalsRegion && totalsRegion.y0 < yFooter - 8
      ? { y0: totalsRegion.y0, y1: yFooter, label: 'tax_summary' }
      : null;

  return {
    headerRegion,
    itemTableRegion,
    taxSummaryRegion,
    totalsRegion,
    footerRegion,
  };
}
