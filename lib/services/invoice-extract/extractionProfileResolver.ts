/**
 * Merge layout priors + benchmark-approved adaptive patches into deterministic runtime knobs.
 */

import type { AdaptiveConfigPatch } from './adaptiveConfigEngine';
import type { SemanticValidationOptions } from './semanticLineValidator';
import type { NumericRepairSearchOptions } from './numericRepairSearch';
import type { OptimizationWeights } from './optimizationScorer';
import { DEFAULT_OPTIMIZATION_WEIGHTS } from './optimizationScorer';
import type { LayoutPriorApplication } from './layoutPriorEngine';

const SEM_REL_DEFAULT = 0.035;
const SEM_ABS_DEFAULT = 2;

export interface CorrectionTelemetryHint {
  field_path_pattern: string;
  correction_events: number;
}

export interface ResolvedExtractionProfile {
  optimizationWeights: OptimizationWeights;
  semanticValidation: SemanticValidationOptions;
  numericRepairSearch: NumericRepairSearchOptions;
  preferredPriceModeHint?: 'inclusive' | 'exclusive';
}

export function resolveOptimizationPriceMode(
  extractPriceMode: 'inclusive' | 'exclusive' | null | undefined,
  hint?: 'inclusive' | 'exclusive' | null,
): 'inclusive' | 'exclusive' {
  if (extractPriceMode === 'exclusive') return 'exclusive';
  if (extractPriceMode === 'inclusive') return 'inclusive';
  return hint ?? 'inclusive';
}

function clampRel(r: number): number {
  return Math.min(0.12, Math.max(0.015, r));
}

function clampAbs(a: number): number {
  return Math.min(12, Math.max(0.5, a));
}

function clampPairs(p: number): number {
  return Math.min(160, Math.max(16, Math.round(p)));
}

export function resolveExtractionProfile(params: {
  mergedAdaptivePatch: AdaptiveConfigPatch;
  layoutPrior: LayoutPriorApplication;
  correctionHints?: CorrectionTelemetryHint[];
}): ResolvedExtractionProfile {
  const lp = params.layoutPrior;

  let rel = SEM_REL_DEFAULT + (lp.semantic_validation_delta.relative_tolerance_delta ?? 0);
  let abs = SEM_ABS_DEFAULT + (lp.semantic_validation_delta.absolute_tolerance_delta ?? 0);

  rel += Number(params.mergedAdaptivePatch.thresholds?.semantic_rel_tolerance_adj ?? 0) || 0;
  abs += Number(params.mergedAdaptivePatch.thresholds?.semantic_abs_tolerance_adj ?? 0) || 0;

  const semanticValidation: SemanticValidationOptions = {
    relativeTolerance: clampRel(rel),
    absoluteTolerance: clampAbs(abs),
    ...params.mergedAdaptivePatch.semantic_validation,
  };

  let maxPairs =
    64 +
    (lp.numeric_repair_delta.max_qty_rate_pairs_delta ?? 0) +
    (Number(params.mergedAdaptivePatch.thresholds?.numeric_max_qty_rate_pairs_adj ?? 0) || 0);
  maxPairs = clampPairs(maxPairs);

  const numericRepairSearch: NumericRepairSearchOptions = {
    maxQtyRatePairs: maxPairs,
    ...params.mergedAdaptivePatch.numeric_repair_search,
  };

  const optimizationWeights: OptimizationWeights = {
    ...DEFAULT_OPTIMIZATION_WEIGHTS,
    ...params.mergedAdaptivePatch.optimization_weights,
  };

  const qtyStress = (params.correctionHints ?? []).some(
    (h) =>
      h.correction_events >= 3 &&
      String(h.field_path_pattern).includes('quantity') &&
      String(h.field_path_pattern).includes('items'),
  );
  if (qtyStress) {
    optimizationWeights.ocrConfidence *= 1.08;
    optimizationWeights.regionConfidence *= 1.06;
  }

  return {
    optimizationWeights,
    semanticValidation,
    numericRepairSearch,
    preferredPriceModeHint: params.mergedAdaptivePatch.preferred_price_mode,
  };
}
