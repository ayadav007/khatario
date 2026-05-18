/**
 * Bounded deterministic search over OCR numeric repair candidates (qty / rate / amount).
 *
 * Uses {@link generateNumericRepairCandidates} digit confusions + decimal drift; caps Cartesian
 * explosion via ranked truncation and greedy acceptance.
 */

import type { OptimizedSemanticInvoiceLine, RepairedFieldTrace } from './invoiceOptimizationTypes';
import type { SemanticInvoiceLineItem } from './semanticInvoiceTypes';
import type { OcrNumericFieldKind } from './ocrNumericRepair';
import { generateNumericRepairCandidates } from './ocrNumericRepair';
import { lineConstraintResidual } from './invoiceConstraintSolver';

export interface NumericRepairSearchOptions {
  /** Max qty candidates × rate candidates explored per greedy step (before amount axis). */
  maxQtyRatePairs?: number;
  /** Also search amount variants when line math is severely violated. */
  searchAmountVariants?: boolean;
  /** Fractional improvement in global composite score required to accept a repair. */
  minRelativeScoreImprovement?: number;
}

const DEFAULT_MAX_PAIR = 64;

/** Deterministic bundles for one line field. */
export function bundleNumericCandidates(
  value: number | undefined,
  kind: OcrNumericFieldKind,
  fallback: number[]
): number[] {
  if (value == null || !Number.isFinite(value)) return [...fallback];
  const cand = generateNumericRepairCandidates(value, kind);
  const set = new Set<number>(cand);
  for (const f of fallback) if (Number.isFinite(f)) set.add(f);
  return [...set].sort((a, b) => Math.abs(a - value) - Math.abs(b - value));
}

function cloneLine(li: SemanticInvoiceLineItem): OptimizedSemanticInvoiceLine {
  return {
    ...li,
    sourceColumns: { ...li.sourceColumns },
    validation: { ...li.validation, warnings: [...li.validation.warnings] },
  };
}

export function cloneAllLines(
  lines: SemanticInvoiceLineItem[]
): OptimizedSemanticInvoiceLine[] {
  return lines.map(cloneLine);
}

/**
 * Greedy pass: visit worst line residuals first; try repair grids; keep strict improvements.
 */
export function greedyRepairSearch(
  working: OptimizedSemanticInvoiceLine[],
  scoreFn: (ls: SemanticInvoiceLineItem[]) => number,
  baselineScore: number,
  priceMode: 'inclusive' | 'exclusive',
  opts?: NumericRepairSearchOptions,
  onReject?: (rowIndex: number, summary: string) => void
): { score: number; repaired: RepairedFieldTrace[] } {
  const maxPairs = opts?.maxQtyRatePairs ?? DEFAULT_MAX_PAIR;
  const minRel = opts?.minRelativeScoreImprovement ?? 0.012;
  const searchAmt = opts?.searchAmountVariants ?? true;

  const repaired: RepairedFieldTrace[] = [];
  let workingScore = baselineScore;

  const order = [...working]
    .map((li) => ({
      li,
      res: lineConstraintResidual(li, priceMode),
    }))
    .filter((x) => x.res > 0.08)
    .sort((a, b) => b.res - a.res);

  for (const { li } of order) {
    const q0 = li.quantity;
    const r0 = li.rate;
    const a0 = li.amount;

    if (
      q0 == null ||
      r0 == null ||
      a0 == null ||
      !(q0 > 0) ||
      !(r0 >= 0) ||
      !(a0 > 0)
    ) {
      onReject?.(li.rowIndex, 'missing_qty_rate_amount_bundle');
      continue;
    }

    const qtyCand = bundleNumericCandidates(q0, 'quantity', [q0]);
    const rateCand = bundleNumericCandidates(r0, 'currency_rate', [r0]);
    const amtCand =
      searchAmt && lineConstraintResidual(li, priceMode) > 1.5
        ? bundleNumericCandidates(a0, 'money_amount', [a0])
        : [a0];

    let improved = false;

    amtLoop: for (const amt of amtCand.slice(0, 7)) {
      let pairs = 0;
      for (const q of qtyCand.slice(0, 14)) {
        for (const r of rateCand.slice(0, 14)) {
          pairs++;
          if (pairs > maxPairs) break amtLoop;

          const trial = working.map(cloneLine);
          const cur = trial.find((x) => x.rowIndex === li.rowIndex);
          if (!cur) break amtLoop;

          cur.quantity = q;
          cur.rate = r;
          cur.amount = amt;

          const s = scoreFn(trial);
          const relGain = (workingScore - s) / Math.max(workingScore, 1e-6);
          if (s + 1e-9 < workingScore && relGain >= minRel) {
            const delta = workingScore - s;
            const rowIndex = li.rowIndex;
            const tri = li.tableRegionIndex;

            if (q !== q0) {
              repaired.push({
                rowIndex,
                tableRegionIndex: tri,
                field: 'quantity',
                from: q0,
                to: q,
                deltaScore: delta,
                reason: 'greedy_qty_rate_amount_grid',
              });
            }
            if (r !== r0) {
              repaired.push({
                rowIndex,
                tableRegionIndex: tri,
                field: 'rate',
                from: r0,
                to: r,
                deltaScore: delta,
                reason: 'greedy_qty_rate_amount_grid',
              });
            }
            if (amt !== a0) {
              repaired.push({
                rowIndex,
                tableRegionIndex: tri,
                field: 'amount',
                from: a0,
                to: amt,
                deltaScore: delta,
                reason: 'greedy_qty_rate_amount_grid',
              });
            }

            Object.assign(li, cur);
            workingScore = s;
            improved = true;
            break amtLoop;
          }
        }
      }
    }

    if (!improved) {
      onReject?.(
        li.rowIndex,
        `no_safe_repair_under_threshold(residual=${lineConstraintResidual(li, priceMode).toFixed(3)})`
      );
    }
  }

  return { score: workingScore, repaired };
}
