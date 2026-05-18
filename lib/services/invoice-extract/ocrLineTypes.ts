/**
 * Canonical OCR line shape for layout + GST engines.
 * All parsers accept coordinates for region-aware decisions.
 */

/** Line role before / after GST propagation heuristics */
export type OcrLineKind = 'gst_header' | 'item' | 'noise' | 'blank';

/** Single logical line from Vision (or any OCR) with geometry */
export interface OcrLine {
  text: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  /** Normalized vertical position in [0,1] when pageHeight known */
  pageNormY?: number;
  /** Classifier output; may be refined after GST propagation pass */
  kind?: OcrLineKind;
  /** Filled by assignSectionGstRates */
  assignedSectionGstRate?: number | null;
}

/** Extended line used in UI / extract pipeline (alias for clarity) */
export type OcrLogicalLine = OcrLine;
