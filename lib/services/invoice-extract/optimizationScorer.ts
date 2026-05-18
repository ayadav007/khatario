/**
 * Weighted global score for invoice interpretations (deterministic).
 * Lower total score = better financial consistency + higher trust in OCR/layout signals.
 */

import type { SemanticInvoiceLineItem } from './semanticInvoiceTypes';
import type { InvoiceOptimizationInput } from './invoiceOptimizationTypes';
import { evaluateInvoiceConstraints } from './invoiceConstraintSolver';

export interface OptimizationWeights {
  line: number;
  slab: number;
  invoice: number;
  ocrConfidence: number;
  regionConfidence: number;
}

export const DEFAULT_OPTIMIZATION_WEIGHTS: OptimizationWeights = {
  line: 1.55,
  slab: 1.12,
  invoice: 1.28,
  ocrConfidence: 0.45,
  regionConfidence: 0.38,
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function meanLineOcrConfidence(lines: SemanticInvoiceLineItem[]): number {
  if (!lines.length) return 0;
  const s = lines.reduce((a, li) => a + clamp01(li.confidence), 0);
  return s / lines.length;
}

/** Region confidence aggregate for lines that carry `tableRegionIndex`. */
export function meanRegionConfidenceForLines(
  lines: SemanticInvoiceLineItem[],
  byRegion?: Record<number, number>
): number {
  if (!byRegion || !Object.keys(byRegion).length) return 0.58;

  const perLine: number[] = [];
  for (const li of lines) {
    const ri = li.tableRegionIndex;
    if (ri == null) continue;
    const c = byRegion[ri];
    if (c != null && Number.isFinite(c)) perLine.push(clamp01(c));
  }

  if (perLine.length) {
    return perLine.reduce((a, b) => a + b, 0) / perLine.length;
  }

  const vals = Object.values(byRegion).filter((x) => Number.isFinite(x)) as number[];
  if (!vals.length) return 0.58;
  return vals.reduce((a, b) => a + clamp01(b), 0) / vals.length;
}

/**
 * Trust penalties rise when OCR / region signals are weak (square amplifies tails).
 */
export function computeTrustPenalties(
  lines: SemanticInvoiceLineItem[],
  input: Pick<InvoiceOptimizationInput, 'regionConfidenceByRegionIndex'>
): { ocrTrust: number; regionTrust: number } {
  const ocrMean = meanLineOcrConfidence(lines);
  const regMean = meanRegionConfidenceForLines(lines, input.regionConfidenceByRegionIndex);
  return {
    ocrTrust: (1 - ocrMean) ** 2,
    regionTrust: (1 - regMean) ** 2,
  };
}

export interface ScoreSnapshot {
  line: number;
  slab: number;
  invoice: number;
  ocrTrust: number;
  regionTrust: number;
  total: number;
  constraintWarnings: string[];
}

export function scoreInterpretation(
  lines: SemanticInvoiceLineItem[],
  input: InvoiceOptimizationInput,
  weights: OptimizationWeights = DEFAULT_OPTIMIZATION_WEIGHTS
): ScoreSnapshot {
  const priceMode = input.priceMode ?? 'inclusive';
  const c = evaluateInvoiceConstraints({
    lines,
    gstSummaries: input.gstSummaries,
    totalsRegions: input.totalsRegions,
    priceMode,
  });
  const t = computeTrustPenalties(lines, input);
  const total =
    c.lineTotal * weights.line +
    c.slabTotal * weights.slab +
    c.invoiceTotal * weights.invoice +
    t.ocrTrust * weights.ocrConfidence +
    t.regionTrust * weights.regionConfidence;

  return {
    line: Math.round(c.lineTotal * weights.line * 1000) / 1000,
    slab: Math.round(c.slabTotal * weights.slab * 1000) / 1000,
    invoice: Math.round(c.invoiceTotal * weights.invoice * 1000) / 1000,
    ocrTrust: Math.round(t.ocrTrust * weights.ocrConfidence * 1000) / 1000,
    regionTrust: Math.round(t.regionTrust * weights.regionConfidence * 1000) / 1000,
    total: Math.round(total * 1000) / 1000,
    constraintWarnings: c.warnings,
  };
}
