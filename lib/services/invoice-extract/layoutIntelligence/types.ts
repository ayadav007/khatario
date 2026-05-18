export type LayoutExtractionStrategy =
  | 'GENERIC'
  | 'KNOWN_LAYOUT'
  | 'KNOWN_VENDOR'
  | 'HIGH_CONFIDENCE_LAYOUT';

export interface KnownLayoutProfileRecord {
  layoutFingerprint: string;
  layoutExtractionStrategy: LayoutExtractionStrategy;
  commonHeaders: Record<string, unknown>;
  tableStructures: Record<string, unknown>;
  gstAnchorRegions: Record<string, unknown>;
  totalsRegions: Record<string, unknown>;
  invoiceNumberAnchors: Record<string, unknown>;
  hintVersion: number;
  totalCalibrationDocs: number;
}

/** Rollup row from `invoice_layout_profiles` for strategy selection (optional). */
export interface LayoutRollupBrief {
  acceptanceRate: number | null;
  correctionRate: number | null;
  totalDocuments: number;
}

export interface LayoutStrategyDecision {
  strategy: LayoutExtractionStrategy;
  /** Row from `known_layout_profiles`, when present */
  knownProfile: KnownLayoutProfileRecord | null;
}
