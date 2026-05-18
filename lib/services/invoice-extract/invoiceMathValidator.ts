/**
 * Invoice-wide deterministic math checks (totals, GST slabs, header sums).
 * Complements line-level checks; does not mutate data.
 *
 * Intentionally does **not** import `indian-gst-invoice-extract` to avoid circular
 * runtime graphs when this module is pulled in from that file.
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Mirror of canonical Indian GST slabs (percent) for legality checks only. */
const LEGAL_GST_SLABS_PERCENT = [
  0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28,
] as const;

/** Minimal extract shape for header / line sums (numeric reconciliation). */
export interface InvoiceWideExtractLike {
  items: Array<{ line_total: number | null }>;
  gst_summary: Array<{ taxable_value: number; gst_rate: number }>;
  grand_total: number | null;
  subtotal: number | null;
  total_cgst: number | null;
  total_sgst: number | null;
  total_igst: number | null;
  round_off: number | null;
}

export interface InvoiceWideScore {
  /** Sum of positive line totals (excludes pure credit lines if caller filters). */
  sumLineTotals: number;
  grandTotal: number | null;
  /** abs(sum(lines) - grand) when both known */
  lineSumVsGrandError: number | null;
  /** subtotal + header taxes + round_off vs grand_total */
  headerCompositionError: number | null;
  /** Sum of slab taxable vs implied from lines — soft */
  slabTaxableSum: number;
}

export interface InvoiceWideValidationResult {
  scores: InvoiceWideScore;
  /** Human-readable flags for debug UI */
  warnings: string[];
}

function sumPositiveLineTotals(extract: InvoiceWideExtractLike): number {
  let s = 0;
  for (const it of extract.items || []) {
    const lt = it.line_total;
    if (lt != null && Number.isFinite(lt) && lt > 0) s += lt;
  }
  return round2(s);
}

function sumSlabTaxable(extract: InvoiceWideExtractLike): number {
  let s = 0;
  for (const row of extract.gst_summary || []) {
    if (row.taxable_value > 0) s += row.taxable_value;
  }
  return round2(s);
}

/**
 * Aggregate invoice-wide reconciliation metrics used for scoring / debug.
 */
export function scoreInvoiceWideReconciliation(
  extract: InvoiceWideExtractLike
): InvoiceWideValidationResult {
  const warnings: string[] = [];
  const sumLineTotals = sumPositiveLineTotals(extract);
  const grand = extract.grand_total;
  const sub = extract.subtotal;
  const taxSum =
    (extract.total_cgst ?? 0) + (extract.total_sgst ?? 0) + (extract.total_igst ?? 0);
  const ro = extract.round_off ?? 0;

  let lineSumVsGrandError: number | null = null;
  if (grand != null && Number.isFinite(grand) && grand > 0) {
    lineSumVsGrandError = Math.abs(sumLineTotals - grand);
    const tol = Math.max(3, grand * 0.03);
    if (lineSumVsGrandError > tol) {
      warnings.push(
        `Sum of line totals (${sumLineTotals}) differs from grand_total (${grand}) beyond tolerance (${tol}).`
      );
    }
  }

  let headerCompositionError: number | null = null;
  if (
    sub != null &&
    Number.isFinite(sub) &&
    grand != null &&
    Number.isFinite(grand) &&
    grand > 0
  ) {
    const composed = round2(sub + taxSum + ro);
    headerCompositionError = Math.abs(composed - grand);
    const tol = Math.max(3, grand * 0.025);
    if (headerCompositionError > tol) {
      warnings.push(
        `subtotal+tax+round_off (${composed}) vs grand_total (${grand}) beyond tolerance (${tol}).`
      );
    }
  }

  const slabTaxableSum = sumSlabTaxable(extract);

  return {
    scores: {
      sumLineTotals,
      grandTotal: grand,
      lineSumVsGrandError,
      headerCompositionError,
      slabTaxableSum,
    },
    warnings,
  };
}

/**
 * Returns true if rate is already on (or near) a legal Indian GST slab.
 */
export function isNearLegalGstSlab(ratePercent: number, tol = 0.15): boolean {
  if (!Number.isFinite(ratePercent) || ratePercent < 0) return false;
  for (const v of LEGAL_GST_SLABS_PERCENT) {
    if (Math.abs(ratePercent - v) <= tol) return true;
  }
  return false;
}
