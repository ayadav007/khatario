/**
 * Deterministic spatial parsing of Google Vision `fullTextAnnotation`.
 * Preserves geometry; produces rows, aligned columns, numeric hints, and table regions.
 *
 * Suitable for thermal receipts, GST invoices, supermarket bills, and e‑commerce PDFs.
 */

import type {
  FullTextAnnotation,
  VisionVertex,
  VisionWord,
  VisionPage,
} from './vision-types';

// --- Geometry primitives ---

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface OcrWord {
  text: string;
  bbox: BoundingBox;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  pageIndex: number;
  blockIndex: number;
  paragraphIndex: number;
  wordIndexInParagraph: number;
  /** Optional Vision-derived hint (no confidence in standard Vision JSON → defaulted). */
  confidence: number;
}

export interface RowConfidenceMeta {
  /** 0–1 monotonic score */
  score: number;
  /** intra-row vertical spread normalized by median word height */
  verticalSpreadRatio: number;
  /** horizontal overlap ratio among words (0 = none) */
  horizontalOverlapRatio: number;
  wordCount: number;
}

export interface OcrRow {
  rowIndex: number;
  words: OcrWord[];
  bbox: BoundingBox;
  /** Reading-order baseline (median center Y of words). */
  baselineY: number;
  confidence: RowConfidenceMeta;
}

export interface ColumnConfidenceMeta {
  score: number;
  /** Rows where ≥1 word mapped to this column */
  rowsHit: number;
  /** Rows used when building anchors */
  rowsConsidered: number;
}

export interface OcrColumn {
  columnIndex: number;
  /** Consolidated horizontal anchor (median of assigned word centers). */
  anchorCenterX: number;
  minX: number;
  maxX: number;
  confidence: ColumnConfidenceMeta;
}

export interface TableRegion {
  regionIndex: number;
  bbox: BoundingBox;
  rowIndices: number[];
  /** Dominant column anchors overlapping this band */
  dominantColumnIndices: number[];
  /** Column indices where numeric density exceeds threshold */
  numericColumnIndices: number[];
  confidence: number;
}

export interface AlignmentConfidenceMeta {
  score: number;
  /** Mean distance |centerX − anchor| for assigned words */
  meanResidualPx: number;
  /** Share of words within merge tolerance of some anchor */
  cleanAssignmentRatio: number;
}

export interface SpatialParseDebug {
  medianWordHeight: number;
  rowClusterTolerancePx: number;
  columnMergeTolerancePx: number;
  /** Aggregate row confidence (mean of row scores). */
  rowConfidenceAggregate: number;
  /** Aggregate column confidence (mean of column scores). */
  columnConfidenceAggregate: number;
  /** Cross-row alignment quality after column snapping. */
  alignment: AlignmentConfidenceMeta;
  numericDensityPerColumn: number[];
}

export interface InvoiceSpatialDocument {
  pageWidth: number;
  pageHeight: number;
  pageCount: number;
  words: OcrWord[];
  rows: OcrRow[];
  columns: OcrColumn[];
  tableRegions: TableRegion[];
  debug: SpatialParseDebug;
}

// --- Bounds helpers ---

function vertexBounds(vertices: VisionVertex[] | undefined): BoundingBox {
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

export function unionBBox(boxes: BoundingBox[]): BoundingBox {
  if (!boxes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return boxes.reduce(
    (acc, b) => ({
      minX: Math.min(acc.minX, b.minX),
      minY: Math.min(acc.minY, b.minY),
      maxX: Math.max(acc.maxX, b.maxX),
      maxY: Math.max(acc.maxY, b.maxY),
    }),
    { ...boxes[0] }
  );
}

function wordText(w: VisionWord): string {
  const syms = w.symbols;
  if (!syms?.length) return '';
  return syms.map((s) => s.text ?? '').join('');
}

function wordBBox(w: VisionWord): BoundingBox | null {
  const t = wordText(w);
  if (!t.trim()) return null;
  const bb = w.boundingBox?.vertices;
  if (bb?.length) return vertexBounds(bb);
  const syms = w.symbols ?? [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
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
  return { minX, minY, maxX, maxY };
}

/** Extract words with geometry (Vision hierarchy preserved via indices). */
export function extractWordsFromAnnotation(
  annotation: FullTextAnnotation | null | undefined
): OcrWord[] {
  if (!annotation?.pages?.length) return [];
  const out: OcrWord[] = [];

  annotation.pages.forEach((page: VisionPage, pageIndex: number) => {
    (page.blocks ?? []).forEach((block, blockIndex) => {
      (block.paragraphs ?? []).forEach((para, paragraphIndex) => {
        (para.words ?? []).forEach((vw: VisionWord, wordIndexInParagraph: number) => {
          const bbox = wordBBox(vw);
          const text = wordText(vw).trim();
          if (!bbox || !text) return;
          const w = bbox.maxX - bbox.minX;
          const h = bbox.maxY - bbox.minY;
          const cx = (bbox.minX + bbox.maxX) / 2;
          const cy = (bbox.minY + bbox.maxY) / 2;
          out.push({
            text,
            bbox,
            centerX: cx,
            centerY: cy,
            width: Math.max(1, w),
            height: Math.max(1, h),
            pageIndex,
            blockIndex,
            paragraphIndex,
            wordIndexInParagraph,
            confidence: 1,
          });
        });
      });
    });
  });

  return out;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function medianWordHeight(words: OcrWord[]): number {
  const hs = words.map((w) => w.height).sort((a, b) => a - b);
  if (!hs.length) return 10;
  return hs[Math.floor(hs.length / 2)] || 10;
}

/** Money / qty / GST-friendly numeric token */
export function looksNumericToken(text: string): boolean {
  const s = text.replace(/\s+/g, '').replace(/[₹Rs.,]/gi, '').replace(/%/g, '');
  if (!s.length) return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return true;
  if (/^-?\d+-\d{1,2}$/.test(text.replace(/\s/g, ''))) return true;
  return /^[\d.,\-]+$/.test(text.replace(/\s/g, '')) && /\d/.test(text);
}

/** Cluster words into rows by Y overlap / proximity (thermal + tilt-tolerant). */
export function clusterWordsIntoRows(words: OcrWord[], tolPx: number): OcrWord[][] {
  if (!words.length) return [];
  const sorted = [...words].sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);
  const rows: OcrWord[][] = [];
  let cur: OcrWord[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const w = sorted[i];
    const ref = cur[0];
    const dy = Math.abs(w.centerY - ref.centerY);
    const overlapY =
      Math.min(w.bbox.maxY, ref.bbox.maxY) - Math.max(w.bbox.minY, ref.bbox.minY);
    const sameBand =
      dy <= tolPx || overlapY > 0.25 * Math.min(w.height, ref.height);
    if (sameBand) cur.push(w);
    else {
      rows.push(cur.sort((a, b) => a.centerX - b.centerX));
      cur = [w];
    }
  }
  rows.push(cur.sort((a, b) => a.centerX - b.centerX));
  return rows;
}

/** Stable reading-order row text (geometry-aware). */
export function rowRawTextSpatial(row: OcrRow): string {
  return [...row.words]
    .sort((a, b) => a.centerX - b.centerX || a.centerY - b.centerY)
    .map((w) => w.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function horizontalOverlapRatio(words: OcrWord[]): number {
  if (words.length < 2) return 0;
  const ws = [...words].sort((a, b) => a.bbox.minX - b.bbox.minX);
  let overlaps = 0;
  for (let i = 0; i < ws.length - 1; i++) {
    const a = ws[i],
      b = ws[i + 1];
    const ix = Math.min(a.bbox.maxX, b.bbox.maxX) - Math.max(a.bbox.minX, b.bbox.minX);
    if (ix > 1 && ix > 0.15 * Math.min(a.width, b.width)) overlaps++;
  }
  return overlaps / (ws.length - 1);
}

function rowConfidence(words: OcrWord[], medianH: number): RowConfidenceMeta {
  if (!words.length) {
    return {
      score: 0,
      verticalSpreadRatio: 1,
      horizontalOverlapRatio: 0,
      wordCount: 0,
    };
  }
  const centers = words.map((w) => w.centerY);
  const spread =
    Math.max(...centers) - Math.min(...centers) || 0;
  const spreadRatio = medianH > 0 ? spread / medianH : 0;
  const hop = horizontalOverlapRatio(words);
  let score = 1;
  score *= Math.max(0.2, 1 - Math.min(1, spreadRatio / 2));
  score *= Math.max(0.3, 1 - hop);
  if (words.length === 1) score *= 0.92;
  return {
    score: Math.round(score * 1000) / 1000,
    verticalSpreadRatio: Math.round(spreadRatio * 1000) / 1000,
    horizontalOverlapRatio: Math.round(hop * 1000) / 1000,
    wordCount: words.length,
  };
}

/**
 * Incremental column anchors (deterministic reading order: rows top→bottom, words left→right).
 * Snap nearby anchors after first pass; final assignments use nearest merged anchor by X.
 */
export function buildColumnAnchors(
  rows: OcrRow[],
  pageWidth: number,
  tolPx: number
): { anchors: number[]; assignments: Map<OcrWord, number> } {
  const tol = Math.max(6, tolPx);
  const anchors: number[] = [];

  for (const row of rows) {
    const ws = [...row.words].sort((a, b) => a.centerX - b.centerX);
    for (const w of ws) {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < anchors.length; i++) {
        const d = Math.abs(w.centerX - anchors[i]);
        if (d < bestD && d <= tol) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) {
        anchors[best] = anchors[best] * 0.62 + w.centerX * 0.38;
      } else {
        anchors.push(w.centerX);
      }
    }
  }

  if (!anchors.length) {
    return { anchors: [], assignments: new Map() };
  }

  const sorted = [...anchors].sort((a, b) => a - b);
  const merged: number[] = [];
  const mergeTol = Math.max(5, tol * 0.42);
  for (const x of sorted) {
    if (!merged.length || x - merged[merged.length - 1] > mergeTol) merged.push(x);
    else merged[merged.length - 1] = (merged[merged.length - 1] + x) / 2;
  }

  const assignments = new Map<OcrWord, number>();
  for (const row of rows) {
    for (const w of row.words) {
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < merged.length; i++) {
        const d = Math.abs(w.centerX - merged[i]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      assignments.set(w, bi);
    }
  }

  void pageWidth;

  return { anchors: merged, assignments };
}

export function buildOcrColumns(
  anchors: number[],
  rows: OcrRow[],
  assignments: Map<OcrWord, number>
): OcrColumn[] {
  if (!anchors.length) return [];

  const centersPerCol: number[][] = anchors.map(() => []);
  const xsLPerCol: number[][] = anchors.map(() => []);
  const xsRPerCol: number[][] = anchors.map(() => []);

  for (const row of rows) {
    for (const w of row.words) {
      const ci = assignments.get(w);
      if (ci == null || ci < 0 || ci >= anchors.length) continue;
      centersPerCol[ci].push(w.centerX);
      xsLPerCol[ci].push(w.bbox.minX);
      xsRPerCol[ci].push(w.bbox.maxX);
    }
  }

  const rowsConsidered = rows.filter((r) => r.words.length >= 2).length || rows.length;

  return anchors.map((_, columnIndex) => {
    const cxs = centersPerCol[columnIndex];
    const anchorCenterX =
      cxs.length > 0 ? median(cxs) : anchors[columnIndex];
    const xsL = xsLPerCol[columnIndex];
    const xsR = xsRPerCol[columnIndex];
    const rowsHit = rows.filter((row) =>
      row.words.some((w) => assignments.get(w) === columnIndex)
    ).length;
    const frac = rowsConsidered > 0 ? rowsHit / rowsConsidered : 0;
    const score = Math.min(1, 0.35 + 0.65 * frac);

    return {
      columnIndex,
      anchorCenterX,
      minX: xsL.length ? Math.min(...xsL) : anchorCenterX - 10,
      maxX: xsR.length ? Math.max(...xsR) : anchorCenterX + 10,
      confidence: {
        score: Math.round(score * 1000) / 1000,
        rowsHit,
        rowsConsidered,
      },
    };
  });
}

export function numericDensityPerColumn(
  cols: OcrColumn[],
  rows: OcrRow[],
  assignments: Map<OcrWord, number>
): number[] {
  const counts = cols.map(() => ({ num: 0, tot: 0 }));
  for (const row of rows) {
    for (const w of row.words) {
      const ci = assignments.get(w);
      if (ci == null || ci < 0 || ci >= counts.length) continue;
      counts[ci].tot++;
      if (looksNumericToken(w.text)) counts[ci].num++;
    }
  }
  return counts.map((c) => (c.tot > 0 ? c.num / c.tot : 0));
}

export function detectTableRegions(
  rows: OcrRow[],
  medianH: number,
  dominantNumericCols: number[]
): TableRegion[] {
  const regions: TableRegion[] = [];
  let idx = 0;

  const rowLooksTabular = (r: OcrRow) =>
    r.words.length >= 3 ||
    r.words.filter((w) => looksNumericToken(w.text)).length >= 2;

  let run: OcrRow[] = [];
  let lastBottom = -Infinity;

  const flush = () => {
    if (run.length < 2) {
      run = [];
      return;
    }
    const bbox = unionBBox(run.map((r) => r.bbox));
    const denseRows = run.filter((r) => r.words.length >= 4).length;
    regions.push({
      regionIndex: idx++,
      bbox,
      rowIndices: run.map((r) => r.rowIndex),
      dominantColumnIndices: [...dominantNumericCols],
      numericColumnIndices: [...dominantNumericCols],
      confidence: Math.min(
        1,
        0.45 +
          0.08 * Math.min(run.length, 20) +
          (denseRows / run.length) * 0.35
      ),
    });
    run = [];
  };

  for (const r of rows) {
    if (!rowLooksTabular(r)) {
      flush();
      lastBottom = -Infinity;
      continue;
    }
    const gap = lastBottom >= 0 ? r.bbox.minY - lastBottom : 0;
    if (run.length && gap > Math.max(medianH * 4, 48)) flush();
    run.push(r);
    lastBottom = r.bbox.maxY;
  }
  flush();

  return regions;
}

/**
 * Parse Vision document into spatial structures (deterministic).
 */
export function parseSpatialDocument(
  annotation: FullTextAnnotation | null | undefined
): InvoiceSpatialDocument | null {
  if (!annotation?.pages?.length) return null;

  const words = extractWordsFromAnnotation(annotation);
  if (!words.length) {
    const p0 = annotation.pages[0];
    return {
      pageWidth: p0.width ?? 1,
      pageHeight: p0.height ?? 1,
      pageCount: annotation.pages.length,
      words: [],
      rows: [],
      columns: [],
      tableRegions: [],
      debug: {
        medianWordHeight: 10,
        rowClusterTolerancePx: 8,
        columnMergeTolerancePx: 8,
        rowConfidenceAggregate: 0,
        columnConfidenceAggregate: 0,
        alignment: { score: 0, meanResidualPx: 0, cleanAssignmentRatio: 0 },
        numericDensityPerColumn: [],
      },
    };
  }

  const page0 = annotation.pages[0];
  const maxRight = Math.max(0, ...words.map((w) => w.bbox.maxX));
  const maxBottom = Math.max(0, ...words.map((w) => w.bbox.maxY));
  const pageWidth =
    page0.width != null && page0.width > 0 ? page0.width : Math.max(maxRight + 8, 1);
  const pageHeight =
    page0.height != null && page0.height > 0 ? page0.height : Math.max(maxBottom + 8, 1);

  const medianH = medianWordHeight(words);
  const tolRow = Math.max(6, medianH * 0.42);

  const wordsByPage = new Map<number, OcrWord[]>();
  for (const w of words) {
    const list = wordsByPage.get(w.pageIndex) ?? [];
    list.push(w);
    wordsByPage.set(w.pageIndex, list);
  }
  const pageIndices = [...wordsByPage.keys()].sort((a, b) => a - b);
  const rowGroups: OcrWord[][] = [];
  for (const pi of pageIndices) {
    const grp = wordsByPage.get(pi)!;
    rowGroups.push(...clusterWordsIntoRows(grp, tolRow));
  }

  const medianHRows = medianWordHeight(words);

  const rows: OcrRow[] = rowGroups.map((grp, rowIndex) => {
    const bbox = unionBBox(grp.map((w) => w.bbox));
    const baselineY = median(grp.map((w) => w.centerY));
    return {
      rowIndex,
      words: grp,
      bbox,
      baselineY,
      confidence: rowConfidence(grp, medianHRows),
    };
  });

  const tolCol = Math.max(8, Math.min(pageWidth * 0.018, medianH * 1.4));
  const { anchors, assignments } = buildColumnAnchors(rows, pageWidth, tolCol);
  const columns = buildOcrColumns(anchors, rows, assignments);

  let residuals = 0;
  let clean = 0;
  let totalW = 0;
  for (const row of rows) {
    for (const w of row.words) {
      totalW++;
      const ci = assignments.get(w);
      if (ci == null || ci >= anchors.length) continue;
      const d = Math.abs(w.centerX - anchors[ci]);
      residuals += d;
      if (d <= tolCol * 1.15) clean++;
    }
  }
  const meanResidual = totalW ? residuals / totalW : 0;
  const cleanRatio = totalW ? clean / totalW : 0;
  let alignScore = Math.min(1, cleanRatio * (1 - Math.min(1, meanResidual / (tolCol * 4))));
  alignScore = Math.round(alignScore * 1000) / 1000;

  const numericHits = numericDensityPerColumn(columns, rows, assignments);
  const dominantNumericCols = numericHits
    .map((d, i) => ({ i, d }))
    .filter((x) => x.d >= 0.38 && columns[x.i].confidence.rowsHit >= 2)
    .map((x) => x.i);

  const tableRegions = detectTableRegions(rows, medianH, dominantNumericCols);

  const rowAgg =
    rows.length > 0
      ? rows.reduce((s, r) => s + r.confidence.score, 0) / rows.length
      : 0;
  const colAgg =
    columns.length > 0
      ? columns.reduce((s, c) => s + c.confidence.score, 0) / columns.length
      : 0;

  return {
    pageWidth,
    pageHeight,
    pageCount: annotation.pages.length,
    words,
    rows,
    columns,
    tableRegions,
    debug: {
      medianWordHeight: Math.round(medianH * 100) / 100,
      rowClusterTolerancePx: Math.round(tolRow * 100) / 100,
      columnMergeTolerancePx: Math.round(tolCol * 100) / 100,
      rowConfidenceAggregate: Math.round(rowAgg * 1000) / 1000,
      columnConfidenceAggregate: Math.round(colAgg * 1000) / 1000,
      alignment: {
        score: alignScore,
        meanResidualPx: Math.round(meanResidual * 100) / 100,
        cleanAssignmentRatio: Math.round(cleanRatio * 1000) / 1000,
      },
      numericDensityPerColumn: numericHits.map((n) => Math.round(n * 1000) / 1000),
    },
  };
}

/** Serialize spatial doc to reading-order lines (optional convenience; preserves trace via row index). */
export function spatialDocumentToLineTexts(doc: InvoiceSpatialDocument): string[] {
  return doc.rows.map((r) =>
    r.words
      .slice()
      .sort((a, b) => a.centerX - b.centerX)
      .map((w) => w.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
