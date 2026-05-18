import type { BoundingBox, OcrWord } from '../ocrSpatialParser';

/** Optional semantic hint from geometry / bands (refined later by header inference). */
export type VisualTableCellSemantic =
  | 'ITEM'
  | 'QTY'
  | 'RATE'
  | 'AMOUNT'
  | 'GST'
  | 'HSN'
  | 'UNKNOWN';

/**
 * Single deterministic cell in the visual row × column lattice.
 */
export type VisualTableCell = {
  rowIndex: number;
  columnIndex: number;
  bbox: BoundingBox;
  words: OcrWord[];
  text: string;
  numericValue?: number;
  semanticType?: VisualTableCellSemantic;
  /** 0–1 */
  confidence: number;
};

export type VisualTableCellEngineDebug = {
  stabilizedCenters: number[];
  boundaries: number[];
  layoutConfidence: number;
  numericBands: Array<{ minX: number; maxX: number; numericShare: number; hits: number }>;
  orphanTokens: Array<{ text: string; centerX: number; centerY: number }>;
  ambiguousAssignmentCount: number;
  columnStability: number[];
  usedVisualPath: boolean;
  fallbackReason?: string;
};
