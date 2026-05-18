/**
 * Per-cell confidence from OCR + geometry + numeric consistency hints.
 */

import type { BoundingBox, OcrRow } from '../ocrSpatialParser';
import { parseNumericCell } from '../numericColumnInterpreter';
import { isNumericLookingToken } from '../numericColumnInterpreter';
import type { NumericBand } from './numericBandDetector';
import type { VisualTableCellSemantic } from './visualTableCellTypes';

export type CellScoreContext = {
  row: OcrRow;
  columnIndex: number;
  columnCount: number;
  medianWordHeight: number;
  numericBands: NumericBand[];
};

function inNumericBand(cx: number, bands: NumericBand[]): boolean {
  return bands.some((b) => cx >= b.minX && cx <= b.maxX);
}

/**
 * 0–1 confidence for a single visual cell.
 */
export function scoreVisualCell(
  text: string,
  words: Array<{ text: string; confidence: number; centerX: number }>,
  bbox: BoundingBox,
  semanticHint: VisualTableCellSemantic,
  ctx: CellScoreContext,
): number {
  let s = 0.42;
  if (words.length) {
    const meanConf = words.reduce((a, w) => a + w.confidence, 0) / words.length;
    s += meanConf * 0.28;
  }
  const h = bbox.maxY - bbox.minY;
  const w = bbox.maxX - bbox.minX;
  if (h > 0 && ctx.medianWordHeight > 0) {
    const ratio = h / ctx.medianWordHeight;
    if (ratio >= 0.65 && ratio <= 4.2) s += 0.08;
  }
  if (w > 0 && ctx.medianWordHeight > 0 && w / ctx.medianWordHeight > 18) s += 0.04; /** wide description cell */

  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (semanticHint !== 'UNKNOWN') s += 0.06;

  if (trimmed && parseNumericCell(trimmed) != null) {
    s += 0.12;
    const cx = (bbox.minX + bbox.maxX) / 2;
    if (inNumericBand(cx, ctx.numericBands)) s += 0.1;
  } else if (trimmed && !isNumericLookingToken(trimmed) && ctx.columnIndex <= Math.max(0, ctx.columnCount - 4)) {
    /** likely description / item */
    s += 0.06;
  }

  /** Penalize very thin cells (possible split token) */
  if (w > 0 && w < ctx.medianWordHeight * 0.35 && trimmed.length <= 1) s -= 0.12;

  return Math.round(Math.min(1, Math.max(0, s)) * 1000) / 1000;
}
