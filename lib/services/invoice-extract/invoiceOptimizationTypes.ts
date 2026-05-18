/**
 * Types for deterministic invoice interpretation optimization / reconciliation.
 */

import type {
  GstSummaryRegionExtract,
  SemanticInvoiceLineItem,
  TotalsRegionExtract,
} from './semanticInvoiceTypes';

/** Engine input bundle (spatial + OCR context). */
export interface InvoiceOptimizationInput {
  lineItems: SemanticInvoiceLineItem[];
  gstSummaries?: GstSummaryRegionExtract[];
  totalsRegions?: TotalsRegionExtract[];
  /**
   * Optional: classifier confidence keyed by table region index ({@link SemanticInvoiceLineItem.tableRegionIndex}).
   */
  regionConfidenceByRegionIndex?: Record<number, number>;
  /**
   * Line-total semantics when comparing qty×rate(+GST) to `amount`.
   * Defaults to `'inclusive'` (common thermal / B2C prints).
   */
  priceMode?: 'inclusive' | 'exclusive';
}

export interface OptimizedSemanticInvoiceLine extends SemanticInvoiceLineItem {
  optimizationReasons?: string[];
}

export interface RepairedFieldTrace {
  rowIndex: number;
  tableRegionIndex?: number;
  field: 'quantity' | 'rate' | 'amount';
  from: number;
  to: number;
  deltaScore: number;
  reason: string;
}

export interface RejectedRepairCandidateTrace {
  rowIndex: number;
  summary: string;
}

export interface InvoiceOptimizationResult {
  optimizedInvoice: { lines: OptimizedSemanticInvoiceLine[] };
  repairedFields: RepairedFieldTrace[];
  rejectedCandidates: RejectedRepairCandidateTrace[];
  /** Lower is better (weighted constraint + trust penalties). */
  optimizationScore: number;
  baselineScore: number;
  warnings: string[];
  /** Diagnostics (weighted pieces after final interpretation). */
  scoreBreakdown: {
    line: number;
    slab: number;
    invoice: number;
    ocrTrust: number;
    regionTrust: number;
    total: number;
  };
}