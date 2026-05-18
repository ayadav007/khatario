/**
 * Deterministic spatial table-region classification for {@link InvoiceSpatialDocument.tableRegions}.
 *
 * Uses keyword signatures, numeric/tabular structure, vertical placement, and row counts — no LLM.
 */

import type { InvoiceSpatialDocument, TableRegion } from './ocrSpatialParser';
import { looksNumericToken } from './ocrSpatialParser';
import type { ClassifiedTableRegionMeta, SpatialTableRegionKind } from './semanticInvoiceTypes';
import { rowRawTextSpatial } from './ocrSpatialParser';

/** Intersection-over-union for horizontal bands (reads invoice rows). */
export function bboxBandIoU(a: TableRegion['bbox'], b: TableRegion['bbox']): number {
  const iy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  if (iy <= 0) return 0;
  const ix = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  if (ix <= 0) return 0;
  const inter = ix * iy;
  const ua =
    (a.maxX - a.minX) * (a.maxY - a.minY) +
    (b.maxX - b.minX) * (b.maxY - b.minY) -
    inter;
  return ua > 0 ? inter / ua : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function countHits(upper: string, patterns: RegExp[]): number {
  let n = 0;
  for (const p of patterns) {
    const flags = p.flags.includes('g') ? p.flags : `${p.flags}g`;
    const re = new RegExp(p.source, flags);
    const m = upper.match(re);
    if (m) n += m.length;
  }
  return n;
}

const RE_GST_SUMMARY = [
  /\bGST\s+SUMMARY\b/,
  /\bTAX\s+SUMMARY\b/,
  /\bTAXABLE\s+VALUE\b/,
  /\bTAX\s+AMOUNT\b/,
  /\bOUTPUT\s+GST\b/,
  /\bINPUT\s+GST\b/,
  /\bHSN\s+SUMMARY\b/,
  /\bRATE\s*\(?%\)?\b/,
  /\bCGST\b/,
  /\bSGST\b/,
  /\bIGST\b/,
];

const RE_TOTALS = [
  /\bGRAND\s+TOTAL\b/,
  /\bSUB\s*TOTAL\b/,
  /\bNET\s+PAY\b/,
  /\bNET\s+AMOUNT\b/,
  /\bAMOUNT\s+PAYABLE\b/,
  /\bROUND\s+OFF\b/,
  /\bBALANCE\s+DUE\b/,
  /\bTOTAL\s+AMOUNT\b/,
];

const RE_HEADER = [
  /\bTAX\s+INVOICE\b/,
  /\bINVOICE\s+NO\b/,
  /\bBILL\s+TO\b/,
  /\bSHIP\s+TO\b/,
  /\bGSTIN\b/,
  /\bPAN\b\/?\s*NO\b/,
];

const RE_FOOTER = [
  /\bTHANK\s+YOU\b/,
  /\bAUTHORIZED\s+SIGNATORY\b/,
  /\bTERMS\s+(&|AND)\s+CONDITIONS\b/,
  /\bE\.?\s*&\.?\s*O\.?\s*E\b/,
  /\bCOMPUTER\s+GENERATED\b/,
];

/** Tabular merchandise hints (column headers / thermal rows). */
const RE_LINE_TABULAR = [
  /\bSR\.?\s*NO\b/,
  /\bS\.\s*NO\b/,
  /\bPARTICULARS\b/,
  /\bDESCRIPTION\b/,
  /\bHSN\b/,
  /\bQTY\b/,
  /\bRATE\b/,
  /\bAMOUNT\b/,
];

function numericStructureScore(rows: ReturnType<typeof rowsForRegion>): number {
  if (!rows.length) return 0;
  let sum = 0;
  for (const r of rows) {
    const nums = r.words.filter((w) => looksNumericToken(w.text)).length;
    sum += nums >= 2 ? 1 : nums >= 1 ? 0.45 : 0;
  }
  return Math.min(1, sum / rows.length);
}

function rowsForRegion(doc: InvoiceSpatialDocument, region: TableRegion) {
  return region.rowIndices.map((i) => doc.rows[i]).filter(Boolean);
}

function verticalBand(region: TableRegion, pageHeight: number): 'top' | 'mid' | 'bottom' {
  const cy = (region.bbox.minY + region.bbox.maxY) / 2;
  const y = cy / Math.max(1, pageHeight);
  if (y < 0.22) return 'top';
  if (y > 0.74) return 'bottom';
  return 'mid';
}

/**
 * Assign a single {@link SpatialTableRegionKind} using deterministic scoring.
 */
export function classifyTableRegion(
  doc: InvoiceSpatialDocument,
  region: TableRegion
): ClassifiedTableRegionMeta {
  const rows = rowsForRegion(doc, region);
  const pageH = Math.max(1, doc.pageHeight);
  const band = verticalBand(region, pageH);
  const combined = rows.map((r) => rowRawTextSpatial(r)).join('\n');
  const upper = combined.toUpperCase();

  const gstHits = countHits(upper, RE_GST_SUMMARY);
  const totalHits = countHits(upper, RE_TOTALS);
  const headerHits = countHits(upper, RE_HEADER);
  const footerHits = countHits(upper, RE_FOOTER);
  const tabHits = countHits(upper, RE_LINE_TABULAR);

  const rowCount = rows.length;
  const numStruct = numericStructureScore(rows);

  const scores: Record<SpatialTableRegionKind, number> = {
    LINE_ITEM_TABLE: 0,
    GST_SUMMARY: 0,
    TOTALS: 0,
    HEADER: 0,
    FOOTER: 0,
    UNKNOWN: 0.05,
  };

  scores.GST_SUMMARY += Math.min(1, gstHits * 0.14);
  scores.GST_SUMMARY += rowCount <= 22 ? 0.08 : 0;
  scores.GST_SUMMARY += gstHits >= 2 && rowCount <= 18 ? 0.12 : 0;

  scores.TOTALS += Math.min(1, totalHits * 0.22);
  scores.TOTALS += rowCount <= 14 ? 0.06 : 0;
  scores.TOTALS += totalHits >= 1 && numStruct < 0.42 ? 0.14 : 0;

  scores.HEADER += Math.min(1, headerHits * 0.18);
  scores.HEADER += band === 'top' ? 0.14 : band === 'bottom' ? -0.12 : 0;
  scores.HEADER += rowCount <= 16 ? 0.08 : -0.05;

  scores.FOOTER += Math.min(1, footerHits * 0.2);
  scores.FOOTER += band === 'bottom' ? 0.18 : band === 'top' ? -0.14 : 0;
  scores.FOOTER += rowCount <= 18 ? 0.06 : 0;

  scores.LINE_ITEM_TABLE += region.confidence * 0.42;
  scores.LINE_ITEM_TABLE += Math.min(1, rowCount / 22) * 0.18;
  scores.LINE_ITEM_TABLE += numStruct * 0.26;
  scores.LINE_ITEM_TABLE += Math.min(1, tabHits * 0.11);

  /** Cross-class penalties */
  if (gstHits >= 4 && rowCount <= 14 && numStruct < 0.38) {
    scores.LINE_ITEM_TABLE -= 0.28;
    scores.GST_SUMMARY += 0.12;
  }
  if (totalHits >= 2 && rowCount <= 12 && tabHits <= 1) {
    scores.LINE_ITEM_TABLE -= 0.18;
    scores.TOTALS += 0.1;
  }
  if (footerHits >= 1 && band === 'bottom' && totalHits >= 1) {
    scores.TOTALS += 0.06;
    scores.FOOTER += 0.05;
  }

  let best: SpatialTableRegionKind = 'UNKNOWN';
  let bestScore = -Infinity;
  let second = -Infinity;
  for (const k of Object.keys(scores) as SpatialTableRegionKind[]) {
    const s = scores[k];
    if (s > bestScore) {
      second = bestScore;
      bestScore = s;
      best = k;
    } else if (s > second) second = s;
  }

  const reasoning: string[] = [
    `rows=${rowCount}`,
    `band=${band}`,
    `spatial_conf=${Math.round(region.confidence * 1000) / 1000}`,
    `gst_kw=${gstHits}`,
    `total_kw=${totalHits}`,
    `tabular_kw=${tabHits}`,
    `numeric_struct=${Math.round(numStruct * 1000) / 1000}`,
    `winner=${best}`,
  ];

  let classificationConfidence =
    Math.round(Math.min(1, Math.max(0, (bestScore - second) / 0.55 + 0.42)) * 1000) / 1000;
  if (bestScore < 0.28 && best !== 'UNKNOWN') {
    best = 'UNKNOWN';
    reasoning.push('low_absolute_score_fallback_unknown');
    classificationConfidence = Math.round(bestScore * 1000) / 1000;
  }

  /** Prefer LINE_ITEM_TABLE when spatial detector was confident and structure looks tabular */
  if (
    best === 'UNKNOWN' &&
    region.confidence >= 0.62 &&
    rowCount >= 4 &&
    numStruct >= 0.38
  ) {
    best = 'LINE_ITEM_TABLE';
    reasoning.push('fallback_tabular_line_table');
    classificationConfidence = Math.min(
      classificationConfidence,
      Math.round(region.confidence * 0.92 * 1000) / 1000
    );
  }

  return {
    regionIndex: region.regionIndex,
    bbox: region.bbox,
    rowIndices: [...region.rowIndices],
    spatialTableConfidence: Math.round(region.confidence * 1000) / 1000,
    regionType: best,
    classificationConfidence,
    reasoning,
  };
}

/**
 * Classify every spatial region + detect overlapping bands (layout ambiguity).
 */
export function classifyAllTableRegions(
  doc: InvoiceSpatialDocument,
  regions: TableRegion[]
): {
  classified: ClassifiedTableRegionMeta[];
  suspiciousOverlaps: Array<{ regions: [number, number]; iou: number }>;
} {
  const suspiciousOverlaps: Array<{ regions: [number, number]; iou: number }> = [];
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const iou = bboxBandIoU(regions[i]!.bbox, regions[j]!.bbox);
      if (iou > 0.06) {
        suspiciousOverlaps.push({
          regions: [regions[i]!.regionIndex, regions[j]!.regionIndex],
          iou: Math.round(iou * 1000) / 1000,
        });
      }
    }
  }

  const classified = [...regions]
    .sort(
      (a, b) =>
        median(rowsForRegion(doc, a).map((r) => r.baselineY)) -
        median(rowsForRegion(doc, b).map((r) => r.baselineY))
    )
    .map((r) => classifyTableRegion(doc, r));

  return { classified, suspiciousOverlaps };
}
