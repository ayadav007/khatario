/**
 * Globally optimize deterministic invoice interpretation by minimizing weighted financial residuals.
 *
 * Constraints (simultaneous):
 * - Line qty×rate(+GST heuristic) vs amount
 * - GST slab taxable sums vs OCR GST-summary hints
 * - Σ line totals / composition vs totals-region anchors
 *
 * Bounded greedy numeric repair search over OCR digit drift / confusion candidates — no LLM.
 */

import type {
  InvoiceOptimizationInput,
  InvoiceOptimizationResult,
  OptimizedSemanticInvoiceLine,
} from './invoiceOptimizationTypes';
export type {
  InvoiceOptimizationInput,
  InvoiceOptimizationResult,
  OptimizedSemanticInvoiceLine,
  RepairedFieldTrace,
  RejectedRepairCandidateTrace,
} from './invoiceOptimizationTypes';
import { greedyRepairSearch, cloneAllLines } from './numericRepairSearch';
import type { NumericRepairSearchOptions } from './numericRepairSearch';
export type { NumericRepairSearchOptions } from './numericRepairSearch';
import {
  DEFAULT_OPTIMIZATION_WEIGHTS,
  scoreInterpretation,
  type OptimizationWeights,
} from './optimizationScorer';
export type { OptimizationWeights } from './optimizationScorer';
export {
  computeTrustPenalties,
  DEFAULT_OPTIMIZATION_WEIGHTS,
  scoreInterpretation,
} from './optimizationScorer';
export {
  evaluateInvoiceConstraints,
  extractTotalsAnchors,
  gstSummaryTargetsFromExtracts,
  lineConstraintResidual,
  taxableBySlabFromLines,
  type ConstraintEvaluationResult,
  type SolveConstraintInputs,
} from './invoiceConstraintSolver';
export { greedyRepairSearch, bundleNumericCandidates, cloneAllLines } from './numericRepairSearch';

export interface OptimizeInvoiceInterpretationOptions {
  weights?: OptimizationWeights;
  search?: NumericRepairSearchOptions;
  /** Skip greedy repair phase (constraints + scoring only). */
  skipRepairSearch?: boolean;
}

function uniqWarnings(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of xs) {
    const k = w.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * Run deterministic reconciliation → greedy OCR numeric repairs capped & gated by global score lift.
 */
export function optimizeInvoiceInterpretation(
  input: InvoiceOptimizationInput,
  options?: OptimizeInvoiceInterpretationOptions
): InvoiceOptimizationResult {
  const weights = options?.weights ?? DEFAULT_OPTIMIZATION_WEIGHTS;

  const workingLines = cloneAllLines(input.lineItems ?? []);

  const scoreFn = (lines: OptimizedSemanticInvoiceLine[]) =>
    scoreInterpretation(lines, input, weights).total;

  const baselineSnap = scoreInterpretation(workingLines, input, weights);
  const baselineScore = baselineSnap.total;

  const rejected: InvoiceOptimizationResult['rejectedCandidates'] = [];
  const repairedFields: InvoiceOptimizationResult['repairedFields'] = [];

  if (
    !options?.skipRepairSearch &&
    workingLines.some(
      (l) =>
        l.quantity != null &&
        l.rate != null &&
        l.amount != null &&
        l.quantity > 0 &&
        l.amount > 0
    )
  ) {
    const { score, repaired } = greedyRepairSearch(
      workingLines,
      scoreFn,
      baselineScore,
      input.priceMode ?? 'inclusive',
      options?.search,
      (rowIdx, summary) =>
        rejected.push({
          rowIndex: rowIdx,
          summary,
        })
    );
    repairedFields.push(...repaired);
  }

  const finalSnap = scoreInterpretation(workingLines, input, weights);

  /** Hard rollback if numerical noise ever regresses score (defensive — should not trigger). */
  let linesOut: OptimizedSemanticInvoiceLine[] = workingLines;
  let repairedOut = repairedFields;

  if (finalSnap.total > baselineScore + 1e-4) {
    linesOut = cloneAllLines(input.lineItems ?? []);
    repairedOut = [];
    rejected.push({
      rowIndex: -1,
      summary: 'rolled_back_repairs_global_score_regression',
    });
  }

  const outSnap = scoreInterpretation(linesOut, input, weights);

  const warnings = uniqWarnings([
    ...baselineSnap.constraintWarnings,
    ...outSnap.constraintWarnings,
    ...(linesOut !== workingLines ? ['repairs_rolled_back_global_regression'] : []),
  ]);

  return {
    optimizedInvoice: { lines: linesOut },
    repairedFields: repairedOut,
    rejectedCandidates: rejected,
    optimizationScore: outSnap.total,
    baselineScore,
    warnings,
    scoreBreakdown: {
      line: outSnap.line,
      slab: outSnap.slab,
      invoice: outSnap.invoice,
      ocrTrust: outSnap.ocrTrust,
      regionTrust: outSnap.regionTrust,
      total: outSnap.total,
    },
  };
}
