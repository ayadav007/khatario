/**
 * PHASE 2 — Infer semantic meaning per OCR column using headers + numeric geometry.
 */

import type { InvoiceSpatialDocument } from './ocrSpatialParser';
import type { SemanticColumnKind } from './semanticInvoiceTypes';
import type { SemanticHeaderDetectionResult } from './semanticHeaderDetector';

export interface InferredColumnSemantics {
  columnIndex: number;
  meaning: SemanticColumnKind;
  score: number;
  reasons: string[];
}

function densityAt(doc: InvoiceSpatialDocument, ci: number): number {
  const d = doc.debug.numericDensityPerColumn;
  return ci >= 0 && ci < d.length ? d[ci] ?? 0 : 0;
}

/** Columns sorted left → right by spatial anchor. */
function columnsLeftToRight(doc: InvoiceSpatialDocument): number[] {
  return doc.columns.map((c) => c.columnIndex).sort((a, b) => {
    const xa = doc.columns[a]?.anchorCenterX ?? 0;
    const xb = doc.columns[b]?.anchorCenterX ?? 0;
    return xa - xb;
  });
}

/**
 * Single deterministic inference pass per column index.
 */
export function inferColumnSemantics(
  doc: InvoiceSpatialDocument,
  header: SemanticHeaderDetectionResult
): InferredColumnSemantics[] {
  const order = columnsLeftToRight(doc);
  const n = order.length;
  if (!n) return [];

  const meaning = new Map<number, SemanticColumnKind>();
  const score = new Map<number, number>();
  const reasons = new Map<number, string[]>();

  const setCol = (ci: number, m: SemanticColumnKind, sc: number, reason: string) => {
    meaning.set(ci, m);
    score.set(ci, Math.max(score.get(ci) ?? 0, sc));
    const rs = reasons.get(ci) ?? [];
    rs.push(reason);
    reasons.set(ci, rs);
  };

  for (const ci of order) setCol(ci, 'UNKNOWN', 0.1, 'init');

  /** Headers override */
  for (const [ci, hm] of header.columnMeanings) {
    if (hm !== 'UNKNOWN') {
      setCol(ci, hm, 0.72 + header.headerConfidence * 0.26, 'header_token');
    }
  }

  const numericRankRight = [...order].sort(
    (a, b) =>
      (doc.columns[b]?.anchorCenterX ?? 0) - (doc.columns[a]?.anchorCenterX ?? 0)
  );

  const assignIfVacant = (
    ci: number | undefined,
    m: SemanticColumnKind,
    sc: number,
    reason: string
  ) => {
    if (ci == null) return;
    if ((meaning.get(ci) ?? 'UNKNOWN') !== 'UNKNOWN') return;
    setCol(ci, m, sc, reason);
  };

  /** Right-most strong numeric strip → AMOUNT */
  for (const ci of numericRankRight) {
    if (densityAt(doc, ci) >= 0.52) {
      assignIfVacant(
        ci,
        'AMOUNT',
        0.58 + 0.35 * densityAt(doc, ci),
        'numeric_dense_right_priority'
      );
      break;
    }
  }

  /** Next numeric column left → RATE */
  let seenAmount = false;
  for (const ci of numericRankRight) {
    const d = densityAt(doc, ci);
    if (d >= 0.52 && meaning.get(ci) === 'AMOUNT') {
      seenAmount = true;
      continue;
    }
    if (seenAmount && d >= 0.38) {
      assignIfVacant(ci, 'RATE', 0.52 + 0.28 * d, 'numeric_inner_rate');
      break;
    }
  }

  /** Left-most sparse numeric → QTY */
  for (const ci of order) {
    const d = densityAt(doc, ci);
    if (d > 0.18 && d < 0.82) {
      assignIfVacant(ci, 'QTY', 0.45 + 0.2 * (1 - d), 'moderate_numeric_qty');
      break;
    }
  }

  /** Left textual column → ITEM */
  for (const ci of order) {
    const d = densityAt(doc, ci);
    if (d < 0.42) {
      assignIfVacant(ci, 'ITEM', 0.5 + (1 - d) * 0.3, 'left_low_numeric_item');
      break;
    }
  }

  /** Secondary left → HSN (often 4–8 digit codes) */
  let itemSeen = false;
  for (const ci of order) {
    if (meaning.get(ci) === 'ITEM') {
      itemSeen = true;
      continue;
    }
    if (itemSeen && densityAt(doc, ci) < 0.55) {
      assignIfVacant(ci, 'HSN', 0.36, 'post_item_low_numeric');
      break;
    }
  }

  /** Remaining UNKNOWN mid-band numeric → GST guess */
  for (const ci of order) {
    if ((meaning.get(ci) ?? 'UNKNOWN') !== 'UNKNOWN') continue;
    const d = densityAt(doc, ci);
    if (d > 0.22 && d < 0.62) setCol(ci, 'GST', 0.34, 'mid_numeric_gst_guess');
    else setCol(ci, 'UNKNOWN', 0.12, 'unclassified');
  }

  return order.map((columnIndex) => ({
    columnIndex,
    meaning: meaning.get(columnIndex) ?? 'UNKNOWN',
    score: Math.round((score.get(columnIndex) ?? 0.12) * 1000) / 1000,
    reasons: reasons.get(columnIndex) ?? [],
  }));
}
