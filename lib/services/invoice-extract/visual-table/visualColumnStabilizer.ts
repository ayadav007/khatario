/**
 * Stabilize column anchors using x-axis density histograms + median refinement.
 * Reduces OCR jitter vs single-pass nearest-anchor clustering alone.
 */

import type { BoundingBox, OcrRow, OcrWord } from '../ocrSpatialParser';
import { unionBBox } from '../ocrSpatialParser';
import type { NumericBand } from './numericBandDetector';

export type StabilizedColumnLayout = {
  /** Final column center X positions, left → right. */
  centers: number[];
  /** boundaries.length === centers.length + 1; token with centerX in [boundaries[i], boundaries[i+1]) → column i */
  boundaries: number[];
  /** 0–1 aggregate stability score. */
  layoutConfidence: number;
};

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function histogramPeaks(
  rows: OcrRow[],
  pageWidth: number,
  medianWordHeight: number,
  regionBbox: BoundingBox,
): number[] {
  const binW = Math.max(3, Math.min(16, medianWordHeight * 0.42, pageWidth * 0.014));
  const maxBin = Math.ceil(pageWidth / binW);
  const hist = new Float64Array(Math.max(8, maxBin + 2));
  for (const row of rows) {
    for (const w of row.words) {
      if (w.centerX < regionBbox.minX || w.centerX > regionBbox.maxX) continue;
      const bi = Math.min(hist.length - 1, Math.max(0, Math.floor(w.centerX / binW)));
      hist[bi] += 1;
    }
  }
  /** Light smoothing */
  const sm = new Float64Array(hist.length);
  for (let i = 0; i < hist.length; i++) {
    sm[i] = ((hist[i - 1] ?? 0) + 2 * hist[i]! + (hist[i + 1] ?? 0)) / 4;
  }
  const mean = sm.reduce((a, b) => a + b, 0) / Math.max(1, sm.length);
  const std = Math.sqrt(sm.reduce((acc, v) => acc + (v - mean) ** 2, 0) / Math.max(1, sm.length));
  const cutoff = mean + Math.max(0.35, std * 0.55);
  const peaks: number[] = [];
  for (let i = 1; i < sm.length - 1; i++) {
    if (sm[i]! >= sm[i - 1]! && sm[i]! >= sm[i + 1]! && sm[i]! >= cutoff) {
      peaks.push((i + 0.5) * binW);
    }
  }
  /** Always include strongest bins if few peaks (narrow thermal). */
  if (peaks.length < 2) {
    const idx = [...sm.entries()]
      .filter(([i]) => i > 0 && i < sm.length - 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([i]) => (i + 0.5) * binW);
    for (const x of idx) {
      if (!peaks.some((p) => Math.abs(p - x) < binW * 2)) peaks.push(x);
    }
  }
  peaks.sort((a, b) => a - b);
  const mergeTol = Math.max(6, medianWordHeight * 1.05);
  const merged: number[] = [];
  for (const x of peaks) {
    if (!merged.length || x - merged[merged.length - 1]! > mergeTol) merged.push(x);
    else merged[merged.length - 1] = (merged[merged.length - 1]! + x) / 2;
  }
  return merged;
}

/**
 * Refine centers by per-column median of assigned word centers (one Lloyd pass).
 */
export function refineCentersFromAssignments(centers: number[], rows: OcrRow[]): number[] {
  if (!centers.length) return [];
  const sorted = [...centers].sort((a, b) => a - b);
  const clusters: OcrWord[][] = sorted.map(() => []);
  for (const row of rows) {
    for (const w of row.words) {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < sorted.length; i++) {
        const d = Math.abs(w.centerX - sorted[i]!);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      clusters[best]!.push(w);
    }
  }

  return sorted.map((c, i) => {
    const pts = clusters[i]!.map((w) => w.centerX);
    if (!pts.length) return c;
    return median(pts);
  });
}

export type StabilizeVisualColumnsParams = {
  rows: OcrRow[];
  pageWidth: number;
  pageHeight: number;
  medianWordHeight: number;
  regionBbox: BoundingBox;
  /** Optional numeric bands — when set, centers overlapping bands boost layout confidence. */
  numericBands?: NumericBand[];
};

/**
 * Produce stable column centers + decision boundaries for cell quantization.
 */
export function stabilizeVisualColumns(params: StabilizeVisualColumnsParams): StabilizedColumnLayout {
  const { rows, pageWidth, medianWordHeight, regionBbox } = params;
  if (!rows.length || pageWidth <= 0) {
    return { centers: [], boundaries: [0, pageWidth], layoutConfidence: 0 };
  }

  let centers = histogramPeaks(rows, pageWidth, medianWordHeight, regionBbox);
  const tolCol = Math.max(8, Math.min(pageWidth * 0.018, medianWordHeight * 1.4));
  void tolCol;
  centers = refineCentersFromAssignments(centers, rows);
  centers.sort((a, b) => a - b);

  /** Drop duplicate centers after refinement */
  const merged: number[] = [];
  const mergeTol = Math.max(5, Math.max(8, Math.min(pageWidth * 0.018, medianWordHeight * 1.4)) * 0.45);
  for (const c of centers) {
    if (!merged.length || c - merged[merged.length - 1]! > mergeTol) merged.push(c);
    else merged[merged.length - 1] = (merged[merged.length - 1]! + c) / 2;
  }
  centers = merged;

  const rb = unionBBox(rows.map((r) => r.bbox));
  const xmin = Math.max(0, Math.min(rb.minX, regionBbox.minX));
  const xmax = Math.min(pageWidth, Math.max(rb.maxX, regionBbox.maxX));

  const boundaries: number[] = [];
  boundaries.push(xmin);
  for (let i = 0; i < centers.length - 1; i++) {
    boundaries.push((centers[i]! + centers[i + 1]!) / 2);
  }
  boundaries.push(xmax);

  /** Layout confidence: column count + agreement with numeric bands */
  let layoutConfidence = 0.55;
  if (centers.length >= 3) layoutConfidence += 0.12;
  if (centers.length >= 5) layoutConfidence += 0.08;
  let bandHits = 0;
  if (params.numericBands?.length) {
    for (const c of centers) {
      if (params.numericBands.some((b) => c >= b.minX && c <= b.maxX)) bandHits++;
    }
    layoutConfidence += 0.15 * (bandHits / Math.max(1, centers.length));
  }
  layoutConfidence = Math.round(Math.min(1, layoutConfidence) * 1000) / 1000;

  return {
    centers,
    boundaries,
    layoutConfidence,
  };
}
