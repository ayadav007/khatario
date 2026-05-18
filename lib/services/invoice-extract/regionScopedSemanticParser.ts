/**
 * PHASE 3–7 — Region-scoped deterministic line extraction for a single LINE_ITEM_TABLE band.
 *
 * Rebuilds column anchors on the subset of rows so narrow receipt columns stay faithful
 * to local geometry (not the global invoice column model).
 */

import { nearestGstRate } from '@/lib/indian-gst-invoice-extract';
import type { OcrLine } from './ocrLineTypes';
import {
  parseHeaderGstRate,
  tryParseGstPlainPercent,
  tryParseIgstPercent,
} from './gstHeaderParser';
import type { InvoiceSpatialDocument, OcrRow, OcrWord } from './ocrSpatialParser';
import {
  buildColumnAnchors,
  buildOcrColumns,
  numericDensityPerColumn,
  rowRawTextSpatial,
} from './ocrSpatialParser';
import {
  parseNumericCell,
  parseQuantityCell,
  isNumericLookingToken,
} from './numericColumnInterpreter';
import { detectSemanticHeaders } from './semanticHeaderDetector';
import { inferColumnSemantics } from './semanticColumnInference';
import {
  numericConsistencyFactor,
  validateSemanticLineItem,
  type SemanticValidationOptions,
} from './semanticLineValidator';
import type {
  ClassifiedTableRegionMeta,
  GstSourceKind,
  SemanticColumnKind,
  SemanticInvoiceLineItem,
  SemanticInvoiceTableParseDebug,
} from './semanticInvoiceTypes';
import { buildVisualTableCellGrid } from './visual-table/visualTableCellEngine';
import type { VisualTableCell, VisualTableCellEngineDebug } from './visual-table/visualTableCellTypes';

function parseGstPercentCell(raw: string): number | undefined {
  const s = raw.replace(/\s+/g, '').replace(/%/g, '');
  const v = parseFloat(s.replace(/,/g, ''));
  if (!Number.isFinite(v) || v < 0 || v > 40) return undefined;
  return nearestGstRate(v);
}

function columnTolerancePx(doc: InvoiceSpatialDocument): number {
  const medianH = doc.debug.medianWordHeight;
  return Math.max(8, Math.min(doc.pageWidth * 0.018, medianH * 1.4));
}

function wordsByColumnFromVisualCells(cells: VisualTableCell[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const c of cells) m.set(c.columnIndex, c.text);
  return m;
}

function wordsByColumn(
  row: OcrRow,
  assignments: Map<OcrWord, number>
): Map<number, string> {
  const tmp = new Map<number, OcrWord[]>();
  for (const w of row.words) {
    const c = assignments.get(w);
    if (c == null) continue;
    const arr = tmp.get(c) ?? [];
    arr.push(w);
    tmp.set(c, arr);
  }
  const out = new Map<number, string>();
  for (const [c, ws] of tmp) {
    ws.sort((a, b) => a.centerX - b.centerX);
    out.set(c, ws.map((x) => x.text).join(' ').trim());
  }
  return out;
}

function classificationNoise(raw: string): 'footer' | 'likely_header_band' | null {
  const t = raw.trim();
  const u = t.toUpperCase();
  if (t.length <= 160 && /^(TOTAL|SUB\s*TOTAL|GRAND\s*TOTAL)\b/i.test(t)) return 'footer';
  if (/\bGRAND\s+TOTAL\b|\bNET\s+PAY\b|\bAMOUNT\s+PAYABLE\b/i.test(u)) return 'footer';
  if (/\bGST\s+SUMMARY\b|\bTAX\s+SUMMARY\b/i.test(u)) return 'footer';
  if (/^(SR\.?\s*NO|SERIAL|S\s*#\b)/i.test(t) && t.length < 120)
    return 'likely_header_band';
  return null;
}

function explicitGstFromRow(raw: string): number | undefined {
  const ig = tryParseIgstPercent(raw);
  if (ig != null) return ig;
  const gp = tryParseGstPlainPercent(raw);
  if (gp != null) return gp;
  if (raw.length < 100) {
    const h = parseHeaderGstRate(raw);
    if (h != null) return h;
  }
  return undefined;
}

function meaningLookup(
  inferred: Map<number, SemanticColumnKind>,
  kind: SemanticColumnKind
): number[] {
  const out: number[] = [];
  for (const [ci, m] of inferred) {
    if (m === kind) out.push(ci);
  }
  return out.sort((a, b) => a - b);
}

function compositeConfidence(params: {
  rowScore: number;
  columnScoresUsed: number[];
  numericFactor: number;
  gstCertainty: number;
  semanticHints: number;
}): number {
  const colMean =
    params.columnScoresUsed.length > 0
      ? params.columnScoresUsed.reduce((a, b) => a + b, 0) /
        params.columnScoresUsed.length
      : 0.3;
  const v =
    params.rowScore * 0.26 +
    colMean * 0.22 +
    params.numericFactor * 0.34 +
    params.gstCertainty * 0.11 +
    params.semanticHints * 0.07;
  return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
}

export interface RegionSemanticParseSlice {
  tableRegionIndex: number;
  lineItems: SemanticInvoiceLineItem[];
  detectedHeaders: SemanticInvoiceTableParseDebug['detectedHeaders'];
  inferredColumns: SemanticInvoiceTableParseDebug['inferredColumns'];
  mergedRows: SemanticInvoiceTableParseDebug['mergedRows'];
  suspiciousRows: number[];
  rejectedRows: SemanticInvoiceTableParseDebug['rejectedRows'];
  confidenceBreakdown: SemanticInvoiceTableParseDebug['confidenceBreakdown'];
  visualTableCellDebug?: VisualTableCellEngineDebug;
}

/**
 * Parse one classified line-item table region (global row indices preserved on output).
 */
export function parseSemanticLinesForRegion(
  doc: InvoiceSpatialDocument,
  classified: ClassifiedTableRegionMeta,
  propagated: OcrLine[],
  valOpts?: SemanticValidationOptions
): RegionSemanticParseSlice {
  const tableRegionIndex = classified.regionIndex;
  const slice: RegionSemanticParseSlice = {
    tableRegionIndex,
    lineItems: [],
    detectedHeaders: [],
    inferredColumns: [],
    mergedRows: [],
    suspiciousRows: [],
    rejectedRows: [],
    confidenceBreakdown: [],
  };

  const regionRows = classified.rowIndices
    .map((i) => doc.rows[i])
    .filter((r): r is OcrRow => r != null)
    .sort((a, b) => a.rowIndex - b.rowIndex);

  if (!regionRows.length) {
    slice.rejectedRows.push({
      rowIndex: -1,
      reason: 'empty_region_rows',
      regionIndex: tableRegionIndex,
    });
    return slice;
  }

  const vg = buildVisualTableCellGrid(doc, classified);

  let assignments: Map<OcrWord, number>;
  let regionalColumns: ReturnType<typeof buildOcrColumns>;
  let regionalNumericDensity: number[];
  const gridByRowIndex = new Map<number, VisualTableCell[]>();

  if (vg.ok) {
    assignments = vg.assignments;
    regionalColumns = vg.ocrColumns;
    regionalNumericDensity = vg.numericDensityPerColumn;
    vg.grid.forEach((rowCells, idx) => {
      gridByRowIndex.set(regionRows[idx]!.rowIndex, rowCells);
    });
    slice.visualTableCellDebug = vg.debug;
  } else {
    const tolCol = columnTolerancePx(doc);
    const { anchors, assignments: asn } = buildColumnAnchors(regionRows, doc.pageWidth, tolCol);
    if (!anchors.length) {
      slice.rejectedRows.push({
        rowIndex: regionRows[0]!.rowIndex,
        reason: 'no_column_anchors_in_region',
        regionIndex: tableRegionIndex,
      });
      return slice;
    }
    assignments = asn;
    regionalColumns = buildOcrColumns(anchors, regionRows, assignments);
    regionalNumericDensity = numericDensityPerColumn(regionalColumns, regionRows, assignments);
  }

  const sliceDoc: InvoiceSpatialDocument = {
    ...doc,
    rows: regionRows,
    columns: regionalColumns,
    tableRegions: [],
    debug: {
      ...doc.debug,
      numericDensityPerColumn: regionalNumericDensity.map((n) => Math.round(n * 1000) / 1000),
    },
  };

  const columnOfWord = (w: OcrWord) => assignments.get(w);
  const header = detectSemanticHeaders(regionRows, columnOfWord);

  for (const c of header.cells) {
    slice.detectedHeaders.push({
      rowIndex: header.headerRowIndex ?? -1,
      columnIndex: c.columnIndex,
      rawText: c.rawText,
      meaning: c.meaning,
      score: Math.round(c.score * 1000) / 1000,
      regionIndex: tableRegionIndex,
    });
  }

  const inferredList = inferColumnSemantics(sliceDoc, header);
  const inferredMap = new Map<number, SemanticColumnKind>();
  const inferredScore = new Map<number, number>();
  for (const e of inferredList) {
    inferredMap.set(e.columnIndex, e.meaning);
    inferredScore.set(e.columnIndex, e.score);
    slice.inferredColumns.push({
      columnIndex: e.columnIndex,
      meaning: e.meaning,
      score: e.score,
      reasons: e.reasons,
      regionIndex: tableRegionIndex,
    });
  }

  const linesOut: SemanticInvoiceLineItem[] = [];

  for (const row of regionRows) {
    const ri = row.rowIndex;
    const raw = rowRawTextSpatial(row);
    const noise = classificationNoise(raw);
    const visualCells = gridByRowIndex.get(ri);
    const cells =
      visualCells && visualCells.length > 0
        ? wordsByColumnFromVisualCells(visualCells)
        : wordsByColumn(row, assignments);

    if (!raw) {
      slice.rejectedRows.push({ rowIndex: ri, reason: 'empty_row', regionIndex: tableRegionIndex });
      continue;
    }

    if (header.headerRowIndex === ri) {
      slice.rejectedRows.push({
        rowIndex: ri,
        reason: 'semantic_header_row',
        regionIndex: tableRegionIndex,
      });
      continue;
    }

    if (noise === 'footer') {
      slice.rejectedRows.push({
        rowIndex: ri,
        reason: 'footer_band_within_region_guard',
        regionIndex: tableRegionIndex,
      });
      continue;
    }

    const numericWords = row.words.filter((w) => isNumericLookingToken(w.text)).length;
    const itemCols = meaningLookup(inferredMap, 'ITEM');
    const amtCols = meaningLookup(inferredMap, 'AMOUNT');
    const rateCols = meaningLookup(inferredMap, 'RATE');
    const qtyCols = meaningLookup(inferredMap, 'QTY');

    const joinCols = (cis: number[]) =>
      cis.map((ci) => cells.get(ci)).filter(Boolean).join(' ').trim();

    const itemText = joinCols(itemCols);
    const qtyRaw = joinCols(qtyCols);
    const rateRaw = joinCols(rateCols);
    const amtRaw = joinCols(amtCols);
    const hsnRaw = joinCols(meaningLookup(inferredMap, 'HSN'));
    const gstRaw = joinCols(meaningLookup(inferredMap, 'GST'));
    const discRaw = joinCols(meaningLookup(inferredMap, 'DISCOUNT'));
    const unitRaw = joinCols(meaningLookup(inferredMap, 'UNIT'));

    const hasStrongNumericRow =
      numericWords >= 2 ||
      parseNumericCell(amtRaw) != null ||
      parseNumericCell(rateRaw) != null;

    const qty = parseQuantityCell(qtyRaw);
    const rate = parseNumericCell(rateRaw);
    const amount = parseNumericCell(amtRaw);
    const discount = parseNumericCell(discRaw);

    if (
      !hasStrongNumericRow &&
      itemText.length >= 2 &&
      !qtyRaw &&
      !rateRaw &&
      !amtRaw &&
      linesOut.length > 0
    ) {
      const prev = linesOut[linesOut.length - 1]!;
      prev.itemName = `${prev.itemName ?? ''} ${itemText}`.trim();
      slice.mergedRows.push({
        fromRowIndices: [prev.rowIndex, ri],
        reason: 'wrapped_item_description',
        regionIndex: tableRegionIndex,
      });
      slice.rejectedRows.push({
        rowIndex: ri,
        reason: 'merged_into_previous_item',
        regionIndex: tableRegionIndex,
      });
      continue;
    }

    if (
      noise === 'likely_header_band' &&
      !hasStrongNumericRow &&
      itemText.length < 4
    ) {
      slice.rejectedRows.push({
        rowIndex: ri,
        reason: 'header_band_noise',
        regionIndex: tableRegionIndex,
      });
      continue;
    }

    const propKind = propagated[ri]?.kind;
    const sectionGst =
      propKind === 'item'
        ? (propagated[ri]?.assignedSectionGstRate ?? undefined)
        : undefined;

    let gstRate: number | undefined = sectionGst;
    let gstSource: GstSourceKind = gstRate != null ? 'section' : 'inferred';

    const gstColParsed = gstRaw ? parseGstPercentCell(gstRaw) : undefined;
    const exRow = explicitGstFromRow(raw);

    if (gstColParsed != null) {
      gstRate = gstColParsed;
      gstSource = 'explicit';
    } else if (exRow != null) {
      gstRate = exRow;
      gstSource = 'explicit';
    }

    let hsnCode: string | undefined;
    const hsnGuess = hsnRaw.replace(/\s/g, '');
    if (/^\d{4,10}$/.test(hsnGuess)) hsnCode = hsnGuess;

    if (
      propagated[ri]?.kind === 'gst_header' &&
      parseHeaderGstRate(raw) != null &&
      !itemText &&
      qty == null &&
      rate == null &&
      amount == null
    ) {
      slice.rejectedRows.push({
        rowIndex: ri,
        reason: 'gst_section_marker',
        regionIndex: tableRegionIndex,
      });
      continue;
    }

    if (!itemText && amount == null && rate == null && qty == null) {
      slice.rejectedRows.push({
        rowIndex: ri,
        reason: 'no_semantic_cells',
        regionIndex: tableRegionIndex,
      });
      continue;
    }

    const unitTrim = unitRaw.replace(/\s+/g, ' ').trim();
    const unit =
      unitTrim.length > 0 && unitTrim.length <= 16 && /^[%a-zA-Z.\-/]+$/.test(unitTrim)
        ? unitTrim
        : undefined;

    const sourceColumns = {
      itemColumn: itemCols[0],
      qtyColumn: qtyCols[0],
      rateColumn: rateCols[0],
      amountColumn: amtCols[0],
      gstColumn: meaningLookup(inferredMap, 'GST')[0],
      hsnColumn: meaningLookup(inferredMap, 'HSN')[0],
      discountColumn: meaningLookup(inferredMap, 'DISCOUNT')[0],
    };

    const columnScoresUsed: number[] = [];
    const usedColSet = new Set([
      ...itemCols,
      ...qtyCols,
      ...rateCols,
      ...amtCols,
      ...meaningLookup(inferredMap, 'GST'),
      ...meaningLookup(inferredMap, 'DISCOUNT'),
      ...meaningLookup(inferredMap, 'UNIT'),
      ...meaningLookup(inferredMap, 'HSN'),
    ]);
    for (const ci of usedColSet) {
      const sc = inferredScore.get(ci);
      if (sc != null) columnScoresUsed.push(sc);
    }

    let draft: SemanticInvoiceLineItem = {
      rowIndex: ri,
      tableRegionIndex,
      itemName: itemText.length ? itemText : undefined,
      hsnCode,
      quantity: qty,
      unit,
      rate,
      amount,
      gstRate,
      gstSource,
      discount,
      confidence: 0,
      rawRowText: raw,
      sourceColumns,
      validation: {
        quantityRateAmountConsistent: true,
        suspicious: false,
        warnings: [],
      },
    };

    draft = validateSemanticLineItem(draft, valOpts);

    const gstCertainty =
      gstColParsed != null || exRow != null
        ? 1
        : gstSource === 'section'
          ? 0.78
          : gstRate != null
            ? 0.52
            : 0.35;

    const semanticHints =
      (draft.itemName != null && draft.itemName.length >= 3 ? 1 : 0.45) *
      (meaningLookup(inferredMap, 'ITEM').length ? 1 : 0.72);

    const numFactor = numericConsistencyFactor(draft);
    const composite = compositeConfidence({
      rowScore: Math.min(1, Math.max(0, row.confidence.score)),
      columnScoresUsed,
      numericFactor: numFactor,
      gstCertainty,
      semanticHints,
    });

    draft = { ...draft, confidence: composite };

    if (draft.validation.suspicious) slice.suspiciousRows.push(ri);

    slice.confidenceBreakdown.push({
      rowIndex: ri,
      regionIndex: tableRegionIndex,
      factors: {
        rowScore: Math.round(Math.min(1, Math.max(0, row.confidence.score)) * 1000) / 1000,
        columnMean:
          columnScoresUsed.length > 0
            ? Math.round(
                (columnScoresUsed.reduce((a, b) => a + b, 0) / columnScoresUsed.length) *
                  1000
              ) / 1000
            : 0,
        numericConsistency: numFactor,
        gstCertainty,
        semanticHints,
      },
      composite,
    });

    linesOut.push(draft);
  }

  slice.lineItems = linesOut;
  return slice;
}
