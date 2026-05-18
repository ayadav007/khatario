/**
 * PHASE 6–7 — Validate qty × rate vs amount + suspicious flags (deterministic).
 */

import type { SemanticInvoiceLineItem } from './semanticInvoiceTypes';

export interface SemanticValidationOptions {
  /** Relative tolerance on amount check e.g. 0.025 = 2.5% */
  relativeTolerance?: number;
  /** Absolute tolerance in rupees */
  absoluteTolerance?: number;
}

const DEFAULT_REL = 0.035;
const DEFAULT_ABS = 2;

export function validateSemanticLineItem(
  line: SemanticInvoiceLineItem,
  opts?: SemanticValidationOptions
): SemanticInvoiceLineItem {
  const rel = opts?.relativeTolerance ?? DEFAULT_REL;
  const abs = opts?.absoluteTolerance ?? DEFAULT_ABS;

  const warnings: string[] = [...line.validation.warnings];
  let suspicious = line.validation.suspicious;
  let qtyRateOk = line.validation.quantityRateAmountConsistent;

  const q = line.quantity;
  const r = line.rate;
  const a = line.amount;

  if (q != null && r != null && a != null && q > 0 && r >= 0 && a > 0) {
    const expected = q * r;
    const delta = Math.abs(expected - a);
    const tol = Math.max(abs, Math.abs(a) * rel);
    qtyRateOk = delta <= tol;
    if (!qtyRateOk) {
      suspicious = true;
      warnings.push(`qty×rate (${expected.toFixed(2)}) ≠ amount (${a}) beyond tol`);
    }
  } else if (q != null && r != null && a == null) {
    warnings.push('missing_amount_with_qty_rate');
    suspicious = true;
    qtyRateOk = false;
  } else if (a != null && q != null && r == null) {
    qtyRateOk = true;
  } else if (a != null && q == null && r != null) {
    qtyRateOk = true;
  }

  if (line.gstRate != null) {
    const legal = [0, 5, 12, 18, 28];
    const nearest = legal.reduce((p, c) =>
      Math.abs(c - line.gstRate!) < Math.abs(p - line.gstRate!) ? c : p
    );
    if (Math.abs(line.gstRate - nearest) > 0.55) {
      warnings.push(`gst_rate_${line.gstRate}_not_near_standard_slab`);
      suspicious = true;
    }
  }

  return {
    ...line,
    validation: {
      quantityRateAmountConsistent: qtyRateOk,
      suspicious,
      warnings,
    },
  };
}

/** Aggregate numeric confidence contribution (0–1). */
export function numericConsistencyFactor(line: SemanticInvoiceLineItem): number {
  if (line.validation.quantityRateAmountConsistent) return 1;
  if (
    line.quantity != null &&
    line.rate != null &&
    line.amount != null &&
    line.quantity > 0 &&
    line.amount! > 0
  )
    return 0.35;
  return 0.55;
}
