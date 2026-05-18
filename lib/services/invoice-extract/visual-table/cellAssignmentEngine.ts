/**
 * Quantize OCR words into row-aligned visual cells using stabilized column boundaries.
 */

import type { BoundingBox, OcrRow, OcrWord } from '../ocrSpatialParser';
import { unionBBox } from '../ocrSpatialParser';

export type CellAssignmentResult = {
  /** Column index per word (global stabilized index). */
  assignments: Map<OcrWord, number>;
  /** Words that fell outside all column slabs (should be rare after clamping). */
  orphans: OcrWord[];
  /** Words where second-nearest column was within tie threshold. */
  ambiguous: Array<{ word: OcrWord; columns: [number, number] }>;
};

/**
 * Map each word to a column using half-open intervals [boundaries[i], boundaries[i+1]).
 * Clamps outside range to nearest edge column.
 */
export function assignWordsToColumns(
  rows: OcrRow[],
  boundaries: number[],
  columnCount: number,
): CellAssignmentResult {
  const assignments = new Map<OcrWord, number>();
  const orphans: OcrWord[] = [];
  const ambiguous: Array<{ word: OcrWord; columns: [number, number] }> = [];

  if (columnCount <= 0 || boundaries.length !== columnCount + 1) {
    for (const row of rows) for (const w of row.words) orphans.push(w);
    return { assignments, orphans, ambiguous };
  }

  const tieEps = 2.5; /** px — thermal jitter */

  for (const row of rows) {
    for (const w of row.words) {
      const x = w.centerX;
      let col = -1;
      for (let i = 0; i < columnCount; i++) {
        const lo = boundaries[i]!;
        const hi = boundaries[i + 1]!;
        if (x >= lo && x < hi) {
          col = i;
          break;
        }
      }
      if (col < 0) {
        if (x < boundaries[0]!) col = 0;
        else if (x >= boundaries[columnCount]!) col = columnCount - 1;
        else col = 0;
      }

      /** Ambiguity: distance to adjacent boundary */
      const bIdx = col === 0 ? 1 : col;
      const boundaryX = boundaries[bIdx]!;
      const dB = Math.abs(x - boundaryX);
      if (dB <= tieEps && col > 0) {
        ambiguous.push({ word: w, columns: [col - 1, col] });
      } else if (dB <= tieEps && col < columnCount - 1) {
        ambiguous.push({ word: w, columns: [col, col + 1] });
      }

      assignments.set(w, col);
    }
  }

  return { assignments, orphans, ambiguous };
}

/**
 * Merge adjacent column texts in the same row for wide descriptive tokens (item name spill).
 * If col `a` is empty-ish and col `a+1` is alphabetic chunk, merge into `a`.
 */
export function mergeWideItemText(
  row: OcrRow,
  byCol: Map<number, OcrWord[]>,
  options?: { maxCols?: number },
): Map<number, OcrWord[]> {
  const maxC = options?.maxCols ?? 24;
  const next = new Map<number, OcrWord[]>();
  for (const [c, ws] of byCol) {
    next.set(c, [...ws].sort((a, b) => a.centerX - b.centerX));
  }
  for (let c = 0; c < maxC - 1; c++) {
    const left = next.get(c) ?? [];
    const right = next.get(c + 1) ?? [];
    if (!left.length || !right.length) continue;
    const leftText = left.map((w) => w.text).join('');
    const rightText = right.map((w) => w.text).join('');
    const leftWeak = leftText.length < 3 || /^\d/.test(leftText.trim());
    const rightAlpha = /[A-Za-z\u0900-\u0CFF]{2,}/.test(rightText) && !/^\d/.test(rightText.trim());
    if (leftWeak && rightAlpha) {
      next.set(c, [...left, ...right].sort((a, b) => a.centerX - b.centerX));
      next.set(c + 1, []);
    }
  }
  void row;
  return next;
}

export function rowWordsByColumn(row: OcrRow, assignments: Map<OcrWord, number>): Map<number, OcrWord[]> {
  const m = new Map<number, OcrWord[]>();
  for (const w of row.words) {
    const c = assignments.get(w);
    if (c == null) continue;
    const arr = m.get(c) ?? [];
    arr.push(w);
    m.set(c, arr);
  }
  return m;
}

export function cellBBox(words: OcrWord[]): BoundingBox {
  if (!words.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return unionBBox(words.map((w) => w.bbox));
}
