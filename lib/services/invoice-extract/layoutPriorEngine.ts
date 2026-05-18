/**
 * Deterministic layout priors from spatial geometry (no DB, no ML).
 */

import type { InvoiceSpatialDocument } from './ocrSpatialParser';

export interface LayoutPriorApplication {
  labels: string[];
  semantic_validation_delta: {
    relative_tolerance_delta?: number;
    absolute_tolerance_delta?: number;
  };
  numeric_repair_delta: {
    max_qty_rate_pairs_delta?: number;
  };
}

export function computeLayoutPriors(params: {
  spatialDocument: InvoiceSpatialDocument | null | undefined;
  layoutFingerprint: string | null;
}): LayoutPriorApplication {
  const labels: string[] = [];
  const semantic_validation_delta: LayoutPriorApplication['semantic_validation_delta'] = {};
  const numeric_repair_delta: LayoutPriorApplication['numeric_repair_delta'] = {};

  const doc = params.spatialDocument;
  const pw = doc?.pageWidth ?? 0;
  const narrow = pw > 0 && pw < 520;
  const alignScore = doc?.debug?.alignment?.score ?? 1;

  if (narrow) {
    labels.push('thermal_width_prior');
    semantic_validation_delta.relative_tolerance_delta =
      (semantic_validation_delta.relative_tolerance_delta ?? 0) + 0.008;
    semantic_validation_delta.absolute_tolerance_delta =
      (semantic_validation_delta.absolute_tolerance_delta ?? 0) + 1;
    numeric_repair_delta.max_qty_rate_pairs_delta =
      (numeric_repair_delta.max_qty_rate_pairs_delta ?? 0) + 16;
  }

  if (doc && alignScore < 0.55) {
    labels.push('weak_column_alignment_prior');
    semantic_validation_delta.relative_tolerance_delta =
      (semantic_validation_delta.relative_tolerance_delta ?? 0) + 0.006;
  }

  const cols = doc?.columns?.length ?? 0;
  if (cols >= 8) {
    labels.push('dense_multi_column_prior');
    numeric_repair_delta.max_qty_rate_pairs_delta =
      (numeric_repair_delta.max_qty_rate_pairs_delta ?? 0) + 8;
  }

  return { labels, semantic_validation_delta, numeric_repair_delta };
}
