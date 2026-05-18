/**
 * Deterministic numeric reconciliation for Indian retail / thermal invoice extracts.
 * Uses line math + bounded OCR digit-repair candidates — **no LLM**.
 *
 * Safe-by-default: only mutates qty/rate when reconciliation strongly improves fit
 * to the printed line total anchor.
 */

import type { IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';
import { generateNumericRepairCandidates } from './ocrNumericRepair';
import {
  defaultLineTotalTolerance,
  expectedInclusiveLineTotal,
  lineInclusiveTotalError,
  type LineAmountConsistencyContext,
} from './lineItemConsistencyChecker';
import { scoreInvoiceWideReconciliation } from './invoiceMathValidator';

/** Minimum confidence [0,1] required before applying a numeric repair. */
const MIN_REPAIR_CONFIDENCE = 0.82;
/** Repaired error must be clearly better than original (avoid noise). */
const MAX_REPAIRED_ERR_RATIO = 0.62;
/** Max candidate evaluations per line (thermal-safe upper bound). */
const MAX_LINE_EVALS = 220;

export interface NumericRepairFieldTrace {
  lineIndex: number;
  field: 'qty' | 'rate' | 'qty+rate';
  originalValue: number;
  /** For combined repair, `originalValue` is qty and `secondaryOriginal` is rate. */
  secondaryOriginal?: number;
  repairedValue: number;
  secondaryRepaired?: number;
  confidence: number;
  repairReason: string;
}

export interface NumericReconciliationDebug {
  suspiciousLines: Array<{
    lineIndex: number;
    reasons: string[];
    metrics?: Record<string, number>;
  }>;
  repairedFields: NumericRepairFieldTrace[];
  rejectedCandidates: Array<{ lineIndex: number; summary: string }>;
  reconciliationScores: Array<{
    lineIndex: number;
    status: 'ok' | 'suspicious' | 'repaired';
    lineError?: number;
    tolerance?: number;
  }>;
  invoiceWide: ReturnType<typeof scoreInvoiceWideReconciliation>;
  /** Notes such as "weighted_quantity_fraction" for audit trails */
  thermalHeuristicsApplied: string[];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function repairConfidence(originalErr: number, newErr: number, tol: number): number {
  if (tol <= 0) return 0;
  const fit = clamp01(1 - newErr / (tol * 2.5));
  const gain =
    originalErr > 1e-6 ? clamp01(Math.min(1.25, originalErr / Math.max(newErr, 1e-6))) : 1;
  return Math.round(clamp01(fit * gain * 0.97) * 100) / 100;
}

function buildLineContext(
  extract: IndianGstInvoiceExtract,
  line: IndianGstInvoiceExtract['items'][0],
  qty: number,
  rate: number
): LineAmountConsistencyContext | null {
  const lt = line.line_total;
  if (lt == null || !Number.isFinite(lt)) return null;
  const gst = line.gst_rate ?? 0;
  const disc = line.discount_amount != null ? Math.abs(line.discount_amount) : 0;
  const discOffInc = line.discount_on_tax_inclusive === true;
  return {
    qty,
    rate,
    lineTotal: lt,
    gstRatePercent: gst,
    discountAmount: disc,
    discountOnTaxInclusive: discOffInc,
    headerPriceMode: extract.price_mode ?? 'exclusive',
  };
}

/**
 * Apply safe numeric OCR repairs in-place on `extract.items` (qty / rate only).
 * Populates `extract.numeric_reconciliation_debug` for tooling and API debug flags.
 */
export function applyNumericOcrReconciliationToExtract(extract: IndianGstInvoiceExtract): void {
  const suspiciousLines: NumericReconciliationDebug['suspiciousLines'] = [];
  const repairedFields: NumericReconciliationDebug['repairedFields'] = [];
  const rejectedCandidates: NumericReconciliationDebug['rejectedCandidates'] = [];
  const reconciliationScores: NumericReconciliationDebug['reconciliationScores'] = [];
  const thermalHeuristicsApplied: string[] = [];

  const invoiceWide = scoreInvoiceWideReconciliation(extract);

  const items = extract.items || [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const lt = it.line_total;
    const rate0 = it.rate != null && Number.isFinite(it.rate) ? it.rate : NaN;
    const qty0 = it.qty != null && Number.isFinite(it.qty) && it.qty > 0 ? it.qty : NaN;

    if (lt == null || !Number.isFinite(lt) || lt === 0) {
      reconciliationScores.push({ lineIndex: i, status: 'ok' });
      continue;
    }

    /** Credit / exchange lines: do not “repair” negatives against a tax model. */
    if (lt < 0 || rate0 < 0 || !(qty0 > 0) || !(rate0 > 0)) {
      reconciliationScores.push({ lineIndex: i, status: 'ok' });
      continue;
    }

    const ctx0 = buildLineContext(extract, it, qty0, rate0);
    if (!ctx0) {
      reconciliationScores.push({ lineIndex: i, status: 'ok' });
      continue;
    }

    const tol = defaultLineTotalTolerance(lt);
    const err0 = lineInclusiveTotalError(ctx0);

    if (err0 <= tol) {
      reconciliationScores.push({ lineIndex: i, status: 'ok', lineError: err0, tolerance: tol });
      continue;
    }

    const reasons: string[] = ['line_total_vs_qty_rate_mismatch'];
    const metrics: Record<string, number> = { err0, tol, qty0, rate0, lineTotal: lt };

    /** Thermal grocery: fractional weights are common — prefer qty repair candidates. */
    if (qty0 < 1000 && !Number.isInteger(qty0)) {
      thermalHeuristicsApplied.push(`line_${i + 1}_weighted_quantity_fraction`);
    }

    suspiciousLines.push({ lineIndex: i, reasons, metrics });

    const qCand = generateNumericRepairCandidates(qty0, 'quantity');
    const rCand = generateNumericRepairCandidates(rate0, 'currency_rate');

    let best = {
      qty: qty0,
      rate: rate0,
      err: err0,
      mode: 'none' as 'none' | 'qty' | 'rate' | 'pair',
    };

    let evalCount = 0;
    const tryPoint = (q: number, r: number, mode: 'qty' | 'rate' | 'pair') => {
      if (!(q > 0) || !(r > 0)) return;
      const ctx = buildLineContext(extract, it, q, r);
      if (!ctx) return;
      const err = lineInclusiveTotalError(ctx);
      evalCount += 1;
      if (err < best.err) {
        best = { qty: q, rate: r, err, mode };
      }
    };

    for (const q of qCand) {
      if (evalCount >= MAX_LINE_EVALS) break;
      tryPoint(q, rate0, 'qty');
    }
    for (const r of rCand) {
      if (evalCount >= MAX_LINE_EVALS) break;
      tryPoint(qty0, r, 'rate');
    }

    /** Joint search only when single-field moves did not land inside tolerance. */
    if (best.err > tol) {
      const qTop = qCand.slice(0, 14);
      const rTop = rCand.slice(0, 14);
      for (const q of qTop) {
        for (const r of rTop) {
          if (evalCount >= MAX_LINE_EVALS) break;
          tryPoint(q, r, 'pair');
        }
        if (evalCount >= MAX_LINE_EVALS) break;
      }
    }

    const conf = repairConfidence(err0, best.err, tol);
    const improvesClearly = best.err <= MAX_REPAIRED_ERR_RATIO * err0 || err0 > tol * 2.5;
    const safe =
      best.err <= tol &&
      conf >= MIN_REPAIR_CONFIDENCE &&
      improvesClearly &&
      (best.qty !== qty0 || best.rate !== rate0);

    if (safe) {
      const exp = expectedInclusiveLineTotal(buildLineContext(extract, it, best.qty, best.rate)!);
      const reason =
        best.mode === 'pair'
          ? `joint_qty_rate_reconciliation (expected_incl ${exp.toFixed(2)} vs line ${lt})`
          : best.mode === 'qty'
            ? `qty×rate reconciliation toward line_total=${lt} (expected_incl ${exp.toFixed(2)})`
            : `rate×qty reconciliation toward line_total=${lt} (expected_incl ${exp.toFixed(2)})`;

      items[i] = {
        ...it,
        qty: best.qty,
        rate: best.rate,
      };

      if (best.mode === 'pair') {
        repairedFields.push({
          lineIndex: i,
          field: 'qty+rate',
          originalValue: qty0,
          secondaryOriginal: rate0,
          repairedValue: best.qty,
          secondaryRepaired: best.rate,
          confidence: conf,
          repairReason: reason,
        });
      } else if (best.mode === 'qty') {
        repairedFields.push({
          lineIndex: i,
          field: 'qty',
          originalValue: qty0,
          repairedValue: best.qty,
          confidence: conf,
          repairReason: reason,
        });
      } else {
        repairedFields.push({
          lineIndex: i,
          field: 'rate',
          originalValue: rate0,
          repairedValue: best.rate,
          confidence: conf,
          repairReason: reason,
        });
      }

      reconciliationScores.push({
        lineIndex: i,
        status: 'repaired',
        lineError: best.err,
        tolerance: tol,
      });
    } else {
      rejectedCandidates.push({
        lineIndex: i,
        summary: `no_safe_repair best_err=${best.err.toFixed(4)} tol=${tol.toFixed(
          4
        )} conf=${conf} mode=${best.mode} evals=${evalCount}`,
      });
      reconciliationScores.push({
        lineIndex: i,
        status: 'suspicious',
        lineError: best.err,
        tolerance: tol,
      });
    }
  }

  extract.numeric_reconciliation_debug = {
    suspiciousLines,
    repairedFields,
    rejectedCandidates,
    reconciliationScores,
    invoiceWide,
    thermalHeuristicsApplied: [...new Set(thermalHeuristicsApplied)],
  };
}
