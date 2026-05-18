/**
 * Structured semantic output from deterministic table parsing on {@link InvoiceSpatialDocument}.
 */

import type { BoundingBox } from './ocrSpatialParser';
import type { VisualTableCellEngineDebug } from './visual-table/visualTableCellTypes';

/** Deterministic spatial table-region role (invoice layout segmentation). */
export type SpatialTableRegionKind =
  | 'LINE_ITEM_TABLE'
  | 'GST_SUMMARY'
  | 'TOTALS'
  | 'HEADER'
  | 'FOOTER'
  | 'UNKNOWN';

export type SemanticColumnKind =
  | 'ITEM'
  | 'QTY'
  | 'RATE'
  | 'AMOUNT'
  | 'GST'
  | 'HSN'
  | 'UNIT'
  | 'DISCOUNT'
  | 'UNKNOWN';

export type GstSourceKind = 'explicit' | 'section' | 'inferred';

export interface SemanticInvoiceLineItem {
  rowIndex: number;

  /** Index into {@link InvoiceSpatialDocument.tableRegions} when region-aware parsing ran. */
  tableRegionIndex?: number;

  itemName?: string;
  hsnCode?: string;

  quantity?: number;
  unit?: string;

  rate?: number;
  amount?: number;

  gstRate?: number;
  gstSource?: GstSourceKind;

  discount?: number;

  /** 0–1 composite confidence */
  confidence: number;

  rawRowText: string;

  sourceColumns: {
    itemColumn?: number;
    qtyColumn?: number;
    rateColumn?: number;
    amountColumn?: number;
    gstColumn?: number;
    hsnColumn?: number;
    discountColumn?: number;
  };

  validation: {
    quantityRateAmountConsistent: boolean;
    suspicious: boolean;
    warnings: string[];
  };
}

export interface ConfidenceBreakdownEntry {
  rowIndex: number;
  /** Source spatial table region when using region-aware parsing. */
  regionIndex?: number;
  factors: Record<string, number>;
  composite: number;
}

/** GST summary band parsed for reconciliation (not merchandise lines). */
export interface GstSummaryRegionExtract {
  regionIndex: number;
  bbox: BoundingBox;
  rows: Array<{
    rowIndex: number;
    rawText: string;
    parsedAmounts: number[];
    inferredGstPercents: number[];
  }>;
}

/** Totals / footer money lines for reconciliation. */
export interface TotalsRegionExtract {
  regionIndex: number;
  bbox: BoundingBox;
  lines: Array<{
    rowIndex: number;
    rawText: string;
    kind:
      | 'subtotal'
      | 'grand_total'
      | 'tax'
      | 'round_off'
      | 'balance'
      | 'other';
    amount?: number;
  }>;
}

export interface ClassifiedTableRegionMeta {
  regionIndex: number;
  bbox: BoundingBox;
  rowIndices: number[];
  spatialTableConfidence: number;
  regionType: SpatialTableRegionKind;
  classificationConfidence: number;
  reasoning: string[];
}

export interface SemanticInvoiceTableParseDebug {
  detectedHeaders: Array<{
    rowIndex: number;
    columnIndex: number;
    rawText: string;
    meaning: SemanticColumnKind;
    score: number;
    regionIndex?: number;
  }>;
  inferredColumns: Array<{
    columnIndex: number;
    meaning: SemanticColumnKind;
    score: number;
    reasons: string[];
    regionIndex?: number;
  }>;
  mergedRows: Array<{
    fromRowIndices: number[];
    reason: string;
    regionIndex?: number;
  }>;
  suspiciousRows: number[];
  rejectedRows: Array<{ rowIndex: number; reason: string; regionIndex?: number }>;
  confidenceBreakdown: ConfidenceBreakdownEntry[];

  /** Region classifier output + geometry (debug / overlays). */
  regionClassifications: ClassifiedTableRegionMeta[];
  suspiciousRegionOverlaps: Array<{ regions: [number, number]; iou: number }>;
  gstSummaryExtractions: GstSummaryRegionExtract[];
  totalsExtractions: TotalsRegionExtract[];
  rejectedRegions: Array<{ regionIndex: number; reason: string }>;
  /** Optional: per LINE_ITEM_TABLE region — visual lattice debugging. */
  visualTableCellSlices?: Array<{
    regionIndex: number;
    debug: VisualTableCellEngineDebug;
  }>;
}

export interface SemanticInvoiceTableParseResult {
  lineItems: SemanticInvoiceLineItem[];
  debug: SemanticInvoiceTableParseDebug;
}
