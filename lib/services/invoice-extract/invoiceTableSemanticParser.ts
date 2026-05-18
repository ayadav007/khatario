/**
 * Deterministic spatial → semantic invoice parser orchestrator (no LLM).
 *
 * Uses {@link InvoiceSpatialDocument.tableRegions} as primary segmentation (with deterministic
 * fallback), classifies each band, extracts merchandise lines only from LINE_ITEM_TABLE regions,
 * and routes GST summary / totals bands to dedicated parsers for reconciliation.
 */

import type { InvoiceSpatialDocument, TableRegion } from './ocrSpatialParser';
import {
  detectTableRegions,
  rowRawTextSpatial,
  unionBBox,
} from './ocrSpatialParser';
import type { OcrLine } from './ocrLineTypes';
import { assignSectionGstRates } from './gstPropagationEngine';
import { parseGstSummaryRegion } from './gstSummaryRegionParser';
import { parseSemanticLinesForRegion } from './regionScopedSemanticParser';
import type {
  SemanticInvoiceLineItem,
  SemanticInvoiceTableParseDebug,
  SemanticInvoiceTableParseResult,
} from './semanticInvoiceTypes';
import type { SemanticValidationOptions } from './semanticLineValidator';
import { classifyAllTableRegions } from './tableRegionClassifier';
import { parseTotalsRegion } from './totalsRegionParser';

export interface ParseInvoiceTableSemanticsOptions extends SemanticValidationOptions {
  validation?: SemanticValidationOptions;
}

function deriveDominantNumericCols(doc: InvoiceSpatialDocument): number[] {
  const d = doc.debug.numericDensityPerColumn;
  return doc.columns
    .map((c) => c.columnIndex)
    .filter((i) => (d[i] ?? 0) >= 0.38 && doc.columns[i]!.confidence.rowsHit >= 2);
}

/**
 * Regions fed into classification: persisted {@link InvoiceSpatialDocument.tableRegions} when
 * present; otherwise re-run spatial table detection; finally a single full-page fallback slice.
 */
export function resolveEffectiveTableRegions(doc: InvoiceSpatialDocument): TableRegion[] {
  if (doc.tableRegions.length > 0) return doc.tableRegions;
  const dominant = deriveDominantNumericCols(doc);
  const inferred = detectTableRegions(doc.rows, doc.debug.medianWordHeight, dominant);
  if (inferred.length > 0) return inferred;
  if (!doc.rows.length) return [];
  return [
    {
      regionIndex: 0,
      bbox: unionBBox(doc.rows.map((r) => r.bbox)),
      rowIndices: doc.rows.map((r) => r.rowIndex),
      dominantColumnIndices: dominant,
      numericColumnIndices: dominant,
      confidence: 0.36,
    },
  ];
}

function emptyDebug(): SemanticInvoiceTableParseDebug {
  return {
    detectedHeaders: [],
    inferredColumns: [],
    mergedRows: [],
    suspiciousRows: [],
    rejectedRows: [],
    confidenceBreakdown: [],
    regionClassifications: [],
    suspiciousRegionOverlaps: [],
    gstSummaryExtractions: [],
    totalsExtractions: [],
    rejectedRegions: [],
  };
}

/**
 * Main entry: spatial document → semantic line items + region-scoped reconciliation debug.
 */
export function parseInvoiceTableSemantics(
  doc: InvoiceSpatialDocument,
  options?: ParseInvoiceTableSemanticsOptions
): SemanticInvoiceTableParseResult {
  const debug = emptyDebug();
  const valOpts = options?.validation ?? options;

  if (!doc.rows.length || !doc.columns.length) {
    return { lineItems: [], debug };
  }

  const effectiveRegions = resolveEffectiveTableRegions(doc);
  const { classified, suspiciousOverlaps } = classifyAllTableRegions(doc, effectiveRegions);
  debug.suspiciousRegionOverlaps = suspiciousOverlaps;

  for (const c of classified) {
    debug.regionClassifications.push({
      regionIndex: c.regionIndex,
      bbox: c.bbox,
      regionType: c.regionType,
      classificationConfidence: c.classificationConfidence,
      reasoning: c.reasoning,
      rowIndices: c.rowIndices,
      spatialTableConfidence: c.spatialTableConfidence,
    });
  }

  const ocrLines: OcrLine[] = doc.rows.map((r) => ({
    text: rowRawTextSpatial(r),
    x: r.bbox.minX,
    y: r.baselineY,
    width: Math.max(1, r.bbox.maxX - r.bbox.minX),
    height: Math.max(1, r.bbox.maxY - r.bbox.minY),
  }));
  const propagated = assignSectionGstRates(ocrLines, {
    pageHeight: Math.max(1, doc.pageHeight),
  }).lines;

  const lineItems: SemanticInvoiceLineItem[] = [];

  for (const meta of classified) {
    switch (meta.regionType) {
      case 'LINE_ITEM_TABLE': {
        const slice = parseSemanticLinesForRegion(doc, meta, propagated, valOpts);
        lineItems.push(...slice.lineItems);
        debug.detectedHeaders.push(...slice.detectedHeaders);
        debug.inferredColumns.push(...slice.inferredColumns);
        debug.mergedRows.push(...slice.mergedRows);
        debug.rejectedRows.push(...slice.rejectedRows);
        debug.confidenceBreakdown.push(...slice.confidenceBreakdown);
        debug.suspiciousRows.push(...slice.suspiciousRows);
        if (slice.visualTableCellDebug) {
          if (!debug.visualTableCellSlices) debug.visualTableCellSlices = [];
          debug.visualTableCellSlices.push({
            regionIndex: meta.regionIndex,
            debug: slice.visualTableCellDebug,
          });
        }
        break;
      }
      case 'GST_SUMMARY':
        debug.gstSummaryExtractions.push(parseGstSummaryRegion(doc, meta));
        break;
      case 'TOTALS':
        debug.totalsExtractions.push(parseTotalsRegion(doc, meta));
        break;
      case 'HEADER':
      case 'FOOTER':
      case 'UNKNOWN':
        debug.rejectedRegions.push({
          regionIndex: meta.regionIndex,
          reason: `skipped_region_type_${meta.regionType}`,
        });
        break;
      default:
        debug.rejectedRegions.push({
          regionIndex: meta.regionIndex,
          reason: 'skipped_region_unknown_kind',
        });
    }
  }

  return { lineItems, debug };
}
