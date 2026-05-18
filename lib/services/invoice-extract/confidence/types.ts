/**
 * Composite confidence types — explicit 4-pillar breakdown (OCR / validation / historical / semantic).
 */

export type InvoiceReviewStatus = 'AUTO_ACCEPT' | 'REVIEW_REQUIRED' | 'LOW_CONFIDENCE';

/** Standard 4-pillar scores, each in [0, 1]. */
export interface ConfidenceBreakdown4 {
  ocr: number;
  validation: number;
  historical: number;
  semantic: number;
}

export interface FieldConfidenceResult<T = unknown> {
  value: T;
  confidence: number;
  confidence_breakdown: ConfidenceBreakdown4;
}

export interface TableConfidenceResult {
  /** Aggregate table / line-items confidence [0, 1] */
  confidence: number;
  confidence_breakdown: ConfidenceBreakdown4;
  line_count: number;
  /** Index of weakest line by composite field confidence (null when no lines). */
  weakest_line_index: number | null;
  /** Per-line composites (optional detail for clients). */
  lines: FieldConfidenceResult<unknown>[];
}

export interface InvoiceCompositeConfidence {
  confidence: number;
  status: InvoiceReviewStatus;
  confidence_breakdown: ConfidenceBreakdown4;
  /** Hot paths only (caller may omit to trim payloads). */
  fields?: Record<string, FieldConfidenceResult>;
  table?: TableConfidenceResult;
}

export interface HistoricalConfidenceSignals {
  layoutAcceptanceRate: number | null;
  layoutCorrectionRate: number | null;
  layoutAvgConfidence: number | null;
  layoutSampleSize: number;
  vendorCorrectionRate: number | null;
  vendorAvgConfidence: number | null;
  vendorSampleSize: number;
  /** Keys like `item.quantity` aligned with learning rollups. */
  fieldCorrectionRates: Record<string, number>;
}

export type SemanticInvoiceLineLike = {
  confidence: number;
  validation?: { quantityRateAmountConsistent?: boolean; suspicious?: boolean };
};

/** Everything the engine needs beyond the canonical extract (all optional). */
export interface InvoiceConfidenceContext {
  /** GST propagation debug when Google Vision + propagation ran. */
  gstPropagation: import('../gstPropagationEngine').OcrGstPropagationDebug | null;
  ocrGstSummary:
    | {
        validation_confidence: number;
        validation_warnings: number;
      }
    | null
    | undefined;
  /** Spatial OCR doc when available. */
  spatial: import('../ocrSpatialParser').InvoiceSpatialDocument | null | undefined;
  /** Semantic line items from deterministic table parse, if available. */
  semanticLines: SemanticInvoiceLineLike[] | null | undefined;
  /** Header detection / column inference confidence [0,1], if available. */
  headerAlignmentScore: number | null | undefined;
  /** Rollup-backed priors; omit when unknown. */
  historical: HistoricalConfidenceSignals | null | undefined;
}
