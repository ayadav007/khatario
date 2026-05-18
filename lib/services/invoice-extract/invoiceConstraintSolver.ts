/**
 * Deterministic constraint evaluation for invoice interpretations (multi-level reconciliation).
 *
 * Levels:
 * 1) Line: qty×rate(+GST/discount heuristic) vs amount
 * 2) GST slab: Σ taxable(lines by slab) vs OCR GST-summary hints
 * 3) Invoice: Σ line totals vs totals-region anchors; optional composition check
 */

import { nearestGstRate } from '@/lib/indian-gst-invoice-extract';
import {
  defaultLineTotalTolerance,
  lineInclusiveTotalError,
  type LineAmountConsistencyContext,
} from './lineItemConsistencyChecker';
import type { GstSummaryRegionExtract, SemanticInvoiceLineItem } from './semanticInvoiceTypes';
import type { TotalsRegionExtract } from './semanticInvoiceTypes';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface SolveConstraintInputs {
  lines: SemanticInvoiceLineItem[];
  gstSummaries?: GstSummaryRegionExtract[];
  totalsRegions?: TotalsRegionExtract[];
  priceMode: 'inclusive' | 'exclusive';
}

/** Per-slab summed taxable approximation from merchandise lines (inclusive base). */
export function taxableBySlabFromLines(
  lines: SemanticInvoiceLineItem[]
): Map<number, number> {
  const map = new Map<number, number>();
  for (const li of lines) {
    const a = li.amount;
    if (a == null || !Number.isFinite(a) || a <= 0) continue;
    const g = li.gstRate;
    let slabKey: number | null =
      g != null && Number.isFinite(g) ? nearestGstRate(g) : null;
    if (slabKey != null && Math.abs(slabKey) < 1e-6) slabKey = 0;

    let taxable: number;
    if (slabKey != null && slabKey > 0) {
      taxable = round2(a / (1 + slabKey / 100));
    } else if (slabKey === 0) {
      taxable = round2(a);
    } else {
      taxable = round2(a);
      slabKey = 0;
    }

    map.set(slabKey, round2((map.get(slabKey) ?? 0) + taxable));
  }
  return map;
}

/**
 * Heuristic GST-summary targets: map slab% → implied taxable column sum from OCR table rows.
 * Deterministic: pick largest numeric cell on a row as taxable when a GST % is present.
 */
export function gstSummaryTargetsFromExtracts(
  regions: GstSummaryRegionExtract[]
): Map<number, number> {
  const acc = new Map<number, number>();
  for (const reg of regions) {
    for (const row of reg.rows) {
      const pcts = row.inferredGstPercents;
      const slabHint = pcts.length ? nearestGstRate(pcts[0]!) : null;
      if (slabHint == null || !Number.isFinite(slabHint)) continue;
      const nums = [...row.parsedAmounts].filter((n) => n > 0);
      nums.sort((a, b) => b - a);
      const taxableHint = nums[0];
      if (taxableHint == null || taxableHint <= 0) continue;
      acc.set(slabHint, round2((acc.get(slabHint) ?? 0) + taxableHint));
    }
  }
  return acc;
}

/** Pull anchor numbers from deterministic totals-region parse. */
export function extractTotalsAnchors(regs: TotalsRegionExtract[]): {
  grandTotal?: number;
  subtotal?: number;
  taxSumApprox?: number;
  roundOff?: number;
} {
  let grandTotal: number | undefined;
  let subtotal: number | undefined;
  let taxSumApprox = 0;
  let taxHits = 0;
  let roundOff: number | undefined;

  for (const reg of regs) {
    for (const L of reg.lines) {
      if (L.amount == null || !Number.isFinite(L.amount)) continue;
      if (L.kind === 'grand_total' || L.kind === 'balance')
        grandTotal = grandTotal ?? L.amount;
      if (L.kind === 'subtotal') subtotal = subtotal ?? L.amount;
      if (L.kind === 'tax') {
        taxSumApprox += L.amount;
        taxHits++;
      }
      if (L.kind === 'round_off') roundOff = (roundOff ?? 0) + L.amount;
    }
  }

  return {
    grandTotal,
    subtotal,
    taxSumApprox: taxHits ? taxSumApprox : undefined,
    roundOff,
  };
}

/** Normalized line residual (0 = within tolerance). */
export function lineConstraintResidual(
  li: SemanticInvoiceLineItem,
  priceMode: 'inclusive' | 'exclusive'
): number {
  const q = li.quantity;
  const r = li.rate;
  const a = li.amount;
  if (q == null || r == null || a == null || !(q > 0) || r < 0 || !(a > 0)) {
    return 0;
  }

  const ctx: LineAmountConsistencyContext = {
    qty: q,
    rate: r,
    lineTotal: a,
    gstRatePercent: li.gstRate ?? 0,
    discountAmount: li.discount != null ? Math.abs(li.discount) : 0,
    discountOnTaxInclusive: false,
    headerPriceMode: priceMode,
  };

  const err = lineInclusiveTotalError(ctx);
  const tol = defaultLineTotalTolerance(a, { relative: 0.028, floor: 0.08 });
  if (err <= tol * 1.08) return 0;
  const excess = (err - tol) / Math.max(tol, 1);
  return Math.min(24, excess * excess);
}

export interface ConstraintEvaluationResult {
  /** Sum of per-line squared-excess residuals (capped). */
  lineTotal: number;
  /** Slab taxable mismatch vs GST summary (0 if no summary signals). */
  slabTotal: number;
  /** Invoice-wide mismatch vs totals regions (0 if no anchors). */
  invoiceTotal: number;
  warnings: string[];
}

/**
 * Evaluate all three constraint layers (pure function; lower component numbers are better).
 */
export function evaluateInvoiceConstraints(input: SolveConstraintInputs): ConstraintEvaluationResult {
  const warnings: string[] = [];
  const { lines, priceMode } = input;

  let lineTotal = 0;
  for (const li of lines) {
    lineTotal += lineConstraintResidual(li, priceMode);
  }

  let slabTotal = 0;
  const gstRegs = input.gstSummaries ?? [];
  if (gstRegs.length) {
    const fromLines = taxableBySlabFromLines(lines);
    const hints = gstSummaryTargetsFromExtracts(gstRegs);
    if (hints.size) {
      const slabs = new Set<number>([...fromLines.keys(), ...hints.keys()]);
      for (const s of slabs) {
        const a = fromLines.get(s) ?? 0;
        const b = hints.get(s) ?? 0;
        if (b <= 0 && a <= 0) continue;
        const den = Math.max(120, b, a * 0.35);
        const rel = Math.abs(a - b) / den;
        slabTotal += Math.min(18, rel * rel * 8);
      }
    }
  }

  let invoiceTotal = 0;
  const totalsRegs = input.totalsRegions ?? [];
  if (totalsRegs.length && lines.some((x) => x.amount != null && x.amount > 0)) {
    const anchors = extractTotalsAnchors(totalsRegs);
    const sumLines = lines.reduce((s, li) => {
      const v = li.amount;
      return s + (v != null && Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);

    if (anchors.grandTotal != null && anchors.grandTotal > 0) {
      const den = Math.max(220, anchors.grandTotal * 0.022);
      const e1 = Math.abs(sumLines - anchors.grandTotal) / den;
      invoiceTotal += Math.min(22, e1 * e1 * 10);
      if (e1 > 0.08) {
        warnings.push(
          `line_sum_vs_grand_total: sum=${round2(sumLines)} grand=${anchors.grandTotal}`
        );
      }
    }

    if (
      anchors.subtotal != null &&
      anchors.subtotal > 0 &&
      anchors.grandTotal != null &&
      anchors.grandTotal > 0
    ) {
      const taxPart = anchors.taxSumApprox ?? 0;
      const ro = anchors.roundOff ?? 0;
      const composed = round2(anchors.subtotal + taxPart + ro);
      const den = Math.max(220, anchors.grandTotal * 0.022);
      const e2 = Math.abs(composed - anchors.grandTotal) / den;
      invoiceTotal += Math.min(15, e2 * e2 * 8);
      if (e2 > 0.08) {
        warnings.push(
          `subtotal_tax_composition: composed=${composed} grand=${anchors.grandTotal}`
        );
      }
    }
  }

  return { lineTotal, slabTotal, invoiceTotal, warnings };
}
