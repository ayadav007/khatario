/**
 * Deterministic targeted repairs — no second LLM pass. Conservative: only fills obvious gaps.
 */

import type { IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';
import {
  expectedInclusiveLineTotal,
  defaultLineTotalTolerance,
  lineInclusiveTotalError,
  type LineCheckerPriceMode,
} from '@/lib/services/invoice-extract/lineItemConsistencyChecker';
import { scoreInvoiceWideReconciliation } from '@/lib/services/invoice-extract/invoiceMathValidator';
import {
  recomputeGstSummaryFromAuthoritativeLines,
  applyConsolidatedForeignTaxSplit,
} from '@/lib/indian-gst-invoice-extract';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function cloneExtract(e: IndianGstInvoiceExtract): IndianGstInvoiceExtract {
  return {
    ...e,
    items: (e.items ?? []).map((it) => ({ ...it })),
    gst_summary: (e.gst_summary ?? []).map((r) => ({ ...r })),
  };
}

function linePriceMode(priceMode: IndianGstInvoiceExtract['price_mode']): LineCheckerPriceMode {
  return priceMode === 'inclusive' ? 'inclusive' : 'exclusive';
}

export function repairTotalsSection(extract: IndianGstInvoiceExtract): {
  patched: IndianGstInvoiceExtract;
  notes: string[];
} {
  const notes: string[] = [];
  const out = cloneExtract(extract);

  let sumLines = 0;
  for (const it of out.items ?? []) {
    const lt = it.line_total;
    if (lt != null && Number.isFinite(lt) && lt > 0) sumLines += lt;
  }
  sumLines = round2(sumLines);

  if (
    (out.grand_total == null || !Number.isFinite(out.grand_total)) &&
    sumLines > 0 &&
    (out.items?.length ?? 0) > 0
  ) {
    out.grand_total = sumLines;
    notes.push('totals: filled grand_total from sum of positive line totals');
  }

  const wide = scoreInvoiceWideReconciliation(out);
  const err = wide.scores.headerCompositionError;
  const grand = out.grand_total;
  const sub = out.subtotal;
  const taxSum = (out.total_cgst ?? 0) + (out.total_sgst ?? 0) + (out.total_igst ?? 0);
  const ro = out.round_off ?? 0;

  if (
    err != null &&
    grand != null &&
    sub != null &&
    Number.isFinite(grand) &&
    Number.isFinite(sub) &&
    grand > 0
  ) {
    const composed = round2(sub + taxSum + ro);
    const delta = grand - composed;
    if (Math.abs(delta) <= 1.5 && Math.abs(delta) > 0.01) {
      out.round_off = round2(ro + delta);
      notes.push(`totals: adjusted round_off by ${round2(delta)} to close header vs grand gap`);
    }
  }

  return { patched: out, notes };
}

export function repairLineItems(extract: IndianGstInvoiceExtract): {
  patched: IndianGstInvoiceExtract;
  notes: string[];
} {
  const notes: string[] = [];
  const out = cloneExtract(extract);
  const items = out.items ?? [];
  const headerPm = linePriceMode(out.price_mode);

  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const qty = it.qty;
    const rate = it.rate;
    const lt = it.line_total;
    const gst = it.gst_rate ?? 0;
    const disc = it.discount_amount ?? 0;
    const discInc = Boolean(it.discount_on_tax_inclusive);

    if (
      qty == null ||
      !Number.isFinite(qty) ||
      rate == null ||
      !Number.isFinite(rate) ||
      lt == null ||
      !Number.isFinite(lt)
    ) {
      continue;
    }

    const ctx = {
      qty,
      rate,
      lineTotal: lt,
      gstRatePercent: gst,
      discountAmount: disc,
      discountOnTaxInclusive: discInc,
      headerPriceMode: headerPm,
    };
    const err = lineInclusiveTotalError(ctx);
    const tol = defaultLineTotalTolerance(lt);
    if (err <= tol) continue;

    const fixed = expectedInclusiveLineTotal(ctx);
    if (Number.isFinite(fixed) && Math.abs(fixed - lt) / Math.max(lt, 1) < 0.08) {
      it.line_total = round2(fixed);
      notes.push(`line ${i + 1}: corrected line_total to implied inclusive (${round2(fixed)})`);
    }
  }

  return { patched: out, notes };
}

export function repairGSTSection(extract: IndianGstInvoiceExtract): {
  patched: IndianGstInvoiceExtract;
  notes: string[];
} {
  const notes: string[] = [];
  const out = cloneExtract(extract);

  if ((out.items?.length ?? 0) === 0) return { patched: out, notes };

  if (!(out.gst_summary?.length ?? 0)) {
    try {
      applyConsolidatedForeignTaxSplit(out);
      recomputeGstSummaryFromAuthoritativeLines(out);
      if ((out.gst_summary?.length ?? 0) > 0) {
        notes.push('gst_summary: synthesized from authoritative line buckets');
      }
    } catch {
      /* deterministic helper should not throw; guard anyway */
    }
  }

  return { patched: out, notes };
}

/**
 * Fixes the case where the LLM extracted `rate = taxable_value` (post-discount) while also
 * extracting `discount_amount` from the invoice's Discount column. This makes the discount
 * impossible (discount ≥ rate), resulting in zero taxable in the form.
 *
 * Common on marketplace invoices (Myntra, Flipkart, Amazon) where columns are:
 * Gross Amount → Discount → Taxable Amount → Tax → Case Total.
 *
 * When detected, two repairs are attempted in priority order:
 * 1. If line_total and gst_rate are available, reconstruct rate as the ex-GST gross
 *    (line_total + discount) / qty / (1 + gst/100) and set discount_on_tax_inclusive = true.
 *    This preserves the full MRP → discount → net flow in the form.
 * 2. Otherwise, simply clear discount_amount so the rate (which equals the taxable value)
 *    is used directly with no double-deduction.
 */
export function repairImpossibleDiscounts(extract: IndianGstInvoiceExtract): {
  patched: IndianGstInvoiceExtract;
  notes: string[];
} {
  const notes: string[] = [];
  const out = cloneExtract(extract);
  const items = out.items ?? [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const disc = it.discount_amount ?? 0;
    const rate = it.rate ?? 0;
    const qty = it.qty ?? 1;

    if (disc <= 0 || rate <= 0 || disc < rate * qty) continue;

    // Discount ≥ rate × qty — impossible. LLM set rate = taxable (post-discount).
    const lt = it.line_total;
    const gst = it.gst_rate;

    if (lt != null && Number.isFinite(lt) && lt > 0 && gst != null && gst > 0) {
      // Reconstruct exclusive gross MRP: (net_incl + discount_incl) / qty / (1 + gst%)
      const grossExcl = (lt + disc) / qty / (1 + gst / 100);
      it.rate = round2(grossExcl);
      it.discount_on_tax_inclusive = true;
      notes.push(
        `line ${i + 1}: impossible discount (${disc} ≥ ${round2(rate * qty)}); reconstructed gross ex-GST rate ${round2(grossExcl)} from line_total+discount, set discount_on_tax_inclusive=true`,
      );
    } else {
      // Fallback: rate already reflects post-discount taxable — just drop the discount
      it.discount_amount = null;
      notes.push(
        `line ${i + 1}: impossible discount (${disc} ≥ ${round2(rate * qty)}); cleared discount_amount (rate appears to be post-discount taxable)`,
      );
    }
  }

  return { patched: out, notes };
}

export function repairExtractSectionsDeterministic(extract: IndianGstInvoiceExtract): {
  patched: IndianGstInvoiceExtract;
  notes: string[];
} {
  let cur = extract;
  const notes: string[] = [];
  const d = repairImpossibleDiscounts(cur);
  cur = d.patched;
  notes.push(...d.notes);
  const t = repairTotalsSection(cur);
  cur = t.patched;
  notes.push(...t.notes);
  const l = repairLineItems(cur);
  cur = l.patched;
  notes.push(...l.notes);
  const g = repairGSTSection(cur);
  cur = g.patched;
  notes.push(...g.notes);
  return { patched: cur, notes };
}
