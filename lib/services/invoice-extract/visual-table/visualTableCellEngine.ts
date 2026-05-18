/**
 * Deterministic visual table cell lattice from OCR geometry (thermal / supermarket friendly).
 * Runs before semantic meaning inference.
 */

import type { ClassifiedTableRegionMeta } from '../semanticInvoiceTypes';
import type { BoundingBox, InvoiceSpatialDocument, OcrColumn, OcrRow, OcrWord } from '../ocrSpatialParser';
import {
  buildColumnAnchors,
  buildOcrColumns,
  numericDensityPerColumn,
} from '../ocrSpatialParser';
import { parseNumericCell } from '../numericColumnInterpreter';
import { isNumericLookingToken } from '../numericColumnInterpreter';
import { detectNumericBands } from './numericBandDetector';
import { stabilizeVisualColumns } from './visualColumnStabilizer';
import {
  assignWordsToColumns,
  cellBBox,
  mergeWideItemText,
  rowWordsByColumn,
} from './cellAssignmentEngine';
import { scoreVisualCell } from './cellConfidenceScorer';
import type {
  VisualTableCell,
  VisualTableCellEngineDebug,
  VisualTableCellSemantic,
} from './visualTableCellTypes';

export type { VisualTableCell, VisualTableCellSemantic, VisualTableCellEngineDebug } from './visualTableCellTypes';

export type VisualTableCellGridResult = {
  ok: boolean;
  grid: VisualTableCell[][];
  assignments: Map<OcrWord, number>;
  ocrColumns: OcrColumn[];
  numericDensityPerColumn: number[];
  anchors: number[];
  debug: VisualTableCellEngineDebug;
};

function envVisualCells(): boolean {
  const v = (process.env.INVOICE_VISUAL_TABLE_CELLS ?? 'true').toLowerCase().trim();
  return v !== '0' && v !== 'false' && v !== 'no';
}

export function visualTableCellsEnabled(): boolean {
  return envVisualCells();
}

function hintSemantic(
  columnIndex: number,
  columnCount: number,
  text: string,
  numericBandPositions: boolean[],
): VisualTableCellSemantic {
  const t = text.replace(/\s+/g, ' ').trim();
  const n = parseNumericCell(t);
  const num = n != null && Math.abs(n) > 1e-9;
  const hsn = /^\d{4,10}$/.test(t.replace(/\s/g, ''));

  if (hsn) return 'HSN';
  if (num && numericBandPositions[columnIndex]) {
    const numericIdx = numericBandPositions
      .map((x, i) => (x ? i : -1))
      .filter((i) => i >= 0);
    const rank = numericIdx.indexOf(columnIndex);
    if (rank >= 0) {
      if (rank === numericIdx.length - 1) return 'AMOUNT';
      if (rank === numericIdx.length - 2) return 'RATE';
      if (rank === numericIdx.length - 3) return 'QTY';
      return 'AMOUNT';
    }
    return isNumericLookingToken(t) ? 'RATE' : 'UNKNOWN';
  }
  if (columnIndex >= columnCount - 1 && num) return 'AMOUNT';
  if (!num && columnIndex < Math.max(1, columnCount - 3)) return 'ITEM';
  return 'UNKNOWN';
}

function columnNumericFlags(
  centers: number[],
  bands: Array<{ minX: number; maxX: number }>,
): boolean[] {
  return centers.map((c) => bands.some((b) => c >= b.minX && c <= b.maxX));
}

export function buildVisualTableCellGrid(
  doc: InvoiceSpatialDocument,
  classified: ClassifiedTableRegionMeta,
): VisualTableCellGridResult {
  const emptyDebug: VisualTableCellEngineDebug = {
    stabilizedCenters: [],
    boundaries: [],
    layoutConfidence: 0,
    numericBands: [],
    orphanTokens: [],
    ambiguousAssignmentCount: 0,
    columnStability: [],
    usedVisualPath: false,
  };

  const regionRows = classified.rowIndices
    .map((i) => doc.rows[i])
    .filter((r): r is OcrRow => r != null)
    .sort((a, b) => a.rowIndex - b.rowIndex);

  if (!regionRows.length) {
    return {
      ok: false,
      grid: [],
      assignments: new Map(),
      ocrColumns: [],
      numericDensityPerColumn: [],
      anchors: [],
      debug: { ...emptyDebug, fallbackReason: 'empty_region' },
    };
  }

  const medianH = doc.debug.medianWordHeight;
  const numericBands = detectNumericBands(regionRows, doc.pageWidth, medianH);

  const layout = stabilizeVisualColumns({
    rows: regionRows,
    pageWidth: doc.pageWidth,
    pageHeight: doc.pageHeight,
    medianWordHeight: medianH,
    regionBbox: classified.bbox,
    numericBands,
  });

  let centers = layout.centers;
  let boundaries = layout.boundaries;

  let usedVisual = visualTableCellsEnabled() && centers.length >= 2;
  let fallbackReason: string | undefined;

  if (!usedVisual) {
    const tol = Math.max(8, Math.min(doc.pageWidth * 0.018, medianH * 1.4));
    const legacy = buildColumnAnchors(regionRows, doc.pageWidth, tol);
    centers = legacy.anchors;
    boundaries = [];
    if (centers.length) {
      boundaries.push(classified.bbox.minX);
      for (let i = 0; i < centers.length - 1; i++) {
        boundaries.push((centers[i]! + centers[i + 1]!) / 2);
      }
      boundaries.push(classified.bbox.maxX);
    }
    if (centers.length < 2) {
      return {
        ok: false,
        grid: [],
        assignments: new Map(),
        ocrColumns: [],
        numericDensityPerColumn: [],
        anchors: [],
        debug: {
          ...emptyDebug,
          usedVisualPath: false,
          fallbackReason: 'too_few_columns',
        },
      };
    }
    usedVisual = false;
    fallbackReason = 'legacy_column_anchors';
  }

  const columnCount = centers.length;
  const { assignments, orphans, ambiguous } = assignWordsToColumns(
    regionRows,
    boundaries,
    columnCount,
  );

  const ocrColumns = buildOcrColumns(centers, regionRows, assignments);
  const regionalNumericDensity = numericDensityPerColumn(ocrColumns, regionRows, assignments);

  const bandFlags = columnNumericFlags(centers, numericBands);

  const columnStability: number[] = centers.map((_, ci) => {
    const xs: number[] = [];
    for (const row of regionRows) {
      for (const w of row.words) {
        if (assignments.get(w) === ci) xs.push(w.centerX);
      }
    }
    if (xs.length < 2) return 0.5;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length);
    return Math.round((1 - Math.min(1, v / Math.max(1, medianH * 2.2))) * 1000) / 1000;
  });

  const grid: VisualTableCell[][] = [];

  for (const row of regionRows) {
    let byCol = rowWordsByColumn(row, assignments);
    byCol = mergeWideItemText(row, byCol, { maxCols: columnCount });
    const cells: VisualTableCell[] = [];
    for (let ci = 0; ci < columnCount; ci++) {
      const words = [...(byCol.get(ci) ?? [])].sort((a, b) => a.centerX - b.centerX);
      const text = words.map((w) => w.text).join(' ').trim();
      const bbox: BoundingBox = words.length ? cellBBox(words) : emptyCellBbox(row, ci, centers, boundaries);
      const numericValue = parseNumericCell(text);
      const semanticType = hintSemantic(ci, columnCount, text, bandFlags);
      const conf = scoreVisualCell(
        text,
        words.map((w) => ({ text: w.text, confidence: w.confidence, centerX: w.centerX })),
        bbox,
        semanticType,
        {
          row,
          columnIndex: ci,
          columnCount,
          medianWordHeight: medianH,
          numericBands,
        },
      );
      cells.push({
        rowIndex: row.rowIndex,
        columnIndex: ci,
        bbox,
        words,
        text,
        numericValue: numericValue != null ? numericValue : undefined,
        semanticType,
        confidence: conf,
      });
    }
    grid.push(cells);
  }

  return {
    ok: true,
    grid,
    assignments,
    ocrColumns,
    numericDensityPerColumn: regionalNumericDensity.map((n) => Math.round(n * 1000) / 1000),
    anchors: centers,
    debug: {
      stabilizedCenters: centers,
      boundaries,
      layoutConfidence: layout.layoutConfidence,
      numericBands,
      orphanTokens: orphans.map((w) => ({
        text: w.text,
        centerX: w.centerX,
        centerY: w.centerY,
      })),
      ambiguousAssignmentCount: ambiguous.length,
      columnStability,
      usedVisualPath: usedVisual && visualTableCellsEnabled(),
      fallbackReason,
    },
  };
}

function emptyCellBbox(
  row: OcrRow,
  ci: number,
  centers: number[],
  boundaries: number[],
): BoundingBox {
  const cx = centers[ci] ?? (row.bbox.minX + row.bbox.maxX) / 2;
  const lo = boundaries[ci] ?? row.bbox.minX;
  const hi = boundaries[ci + 1] ?? row.bbox.maxX;
  const half = Math.max(4, (hi - lo) * 0.02);
  return {
    minX: cx - half,
    maxX: cx + half,
    minY: row.bbox.minY,
    maxY: row.bbox.maxY,
  };
}
