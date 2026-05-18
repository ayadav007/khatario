/**
 * X-axis numeric token density → vertical bands (qty/rate/amount strips on thermal receipts).
 * Deterministic; no ML.
 */

import type { OcrRow } from '../ocrSpatialParser';
import { isNumericLookingToken } from '../numericColumnInterpreter';

export type NumericBand = {
  minX: number;
  maxX: number;
  /** Share of tokens in band that look numeric (0–1). */
  numericShare: number;
  /** Total OCR tokens overlapping the band (row-weighted). */
  hits: number;
};

function binWidthFromLayout(medianWordHeight: number, pageWidth: number): number {
  return Math.max(3, Math.min(14, medianWordHeight * 0.38, pageWidth * 0.012));
}

/**
 * Histogram numeric-vs-total ratio per x-bin; merge contiguous bins above threshold into bands.
 */
export function detectNumericBands(
  rows: OcrRow[],
  pageWidth: number,
  medianWordHeight: number,
): NumericBand[] {
  if (!rows.length || pageWidth <= 0) return [];
  const binW = binWidthFromLayout(medianWordHeight, pageWidth);
  const nBins = Math.max(8, Math.ceil(pageWidth / binW));
  const num = new Float64Array(nBins);
  const tot = new Float64Array(nBins);

  for (const row of rows) {
    for (const w of row.words) {
      const bi = Math.min(nBins - 1, Math.max(0, Math.floor(w.centerX / binW)));
      tot[bi] += 1;
      if (isNumericLookingToken(w.text)) num[bi] += 1;
    }
  }

  const ratio: number[] = [];
  for (let i = 0; i < nBins; i++) {
    ratio.push(tot[i]! > 0 ? num[i]! / tot[i]! : 0);
  }

  /** Smooth (3-tap) to reduce single-bin noise on thermal. */
  const smooth: number[] = [];
  for (let i = 0; i < nBins; i++) {
    const a = ratio[i - 1] ?? ratio[i]!;
    const b = ratio[i]!;
    const c = ratio[i + 1] ?? ratio[i]!;
    smooth.push((a + 2 * b + c) / 4);
  }

  const threshold = 0.32;
  const active = smooth.map((r) => r >= threshold);

  const bands: NumericBand[] = [];
  let start: number | null = null;
  for (let i = 0; i < nBins; i++) {
    if (active[i] && start == null) start = i;
    if (!active[i] && start != null) {
      const s = start;
      const e = i - 1;
      start = null;
      let nh = 0,
        th = 0;
      for (let j = s; j <= e; j++) {
        nh += num[j]!;
        th += tot[j]!;
      }
      const minX = s * binW;
      const maxX = Math.min(pageWidth, (e + 1) * binW);
      bands.push({
        minX,
        maxX,
        numericShare: th > 0 ? nh / th : 0,
        hits: th,
      });
    }
  }
  if (start != null) {
    const s = start;
    const e = nBins - 1;
    let nh = 0,
      th = 0;
    for (let j = s; j <= e; j++) {
      nh += num[j]!;
      th += tot[j]!;
    }
    bands.push({
      minX: s * binW,
      maxX: pageWidth,
      numericShare: th > 0 ? nh / th : 0,
      hits: th,
    });
  }

  return mergeAdjacentNumericBands(bands, medianWordHeight * 0.85);
}

function mergeAdjacentNumericBands(bands: NumericBand[], gapTol: number): NumericBand[] {
  if (!bands.length) return [];
  const out: NumericBand[] = [];
  let cur = { ...bands[0]! };
  for (let i = 1; i < bands.length; i++) {
    const b = bands[i]!;
    if (b.minX - cur.maxX <= gapTol) {
      const hits = cur.hits + b.hits;
      const numericShare =
        hits > 0 ? (cur.numericShare * cur.hits + b.numericShare * b.hits) / hits : 0;
      cur = {
        minX: cur.minX,
        maxX: b.maxX,
        numericShare,
        hits,
      };
    } else {
      out.push(cur);
      cur = { ...b };
    }
  }
  out.push(cur);
  return out;
}
