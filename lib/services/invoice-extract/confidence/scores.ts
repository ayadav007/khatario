/**
 * Deterministic pillar scores documented inline — no LLM / randomness.
 */

import type { IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';
import {
  GSTIN_RE,
  parseDateToISO,
  nearestGstRate,
  VALID_GST_RATES,
  gstinStateCode,
} from '@/lib/indian-gst-invoice-extract';
import {
  scoreInvoiceWideReconciliation,
  isNearLegalGstSlab,
} from '@/lib/services/invoice-extract/invoiceMathValidator';
import { validateGstExtractAgainstOcr } from '@/lib/services/invoice-extract/gstValidationEngine';
import type { OcrGstPropagationDebug } from '@/lib/services/invoice-extract/gstPropagationEngine';
import type { InvoiceSpatialDocument } from '@/lib/services/invoice-extract/ocrSpatialParser';
import {
  defaultLineTotalTolerance,
  lineInclusiveTotalError,
  type LineCheckerPriceMode,
} from '@/lib/services/invoice-extract/lineItemConsistencyChecker';

import type { HistoricalConfidenceSignals, InvoiceConfidenceContext, SemanticInvoiceLineLike } from './types';
import { clamp01, meanFinite } from './math';

/** Neutral OCR prior when Vision spatial doc is unavailable. */
const OCR_NEUTRAL = 0.58;
export const HISTORICAL_NEUTRAL = 0.62;
const SEMANTIC_NEUTRAL_BASE = 0.52;

function blend(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

function roundP(x: number): number {
  return Math.round((clamp01(x) + Number.EPSILON) * 10000) / 10000;
}

/**
 * OCR pillar: blends Vision spatial quality (words/rows/columns/alignment/bbox proxies)
 * with optional OCR-GST reconciliation confidence.
 */
export function computeOcrPillar(params: {
  spatial: InvoiceSpatialDocument | null | undefined;
  ocrGstSummary: InvoiceConfidenceContext['ocrGstSummary'];
}): number {
  let spatialScore: number | null = null;

  const doc = params.spatial;
  if (doc && doc.words.length && doc.rows.length) {
    const wordScores = doc.words.map((w) => clamp01(w.confidence));
    const wordMean = meanFinite(wordScores) ?? 0.55;

    const rowScores = doc.rows.map((r) => clamp01(r.confidence.score));
    const rowMean = meanFinite(rowScores) ?? wordMean;

    const spreads = doc.rows.map((r) =>
      clamp01(1 - Math.min(0.55, r.confidence.verticalSpreadRatio * 2.15)),
    );
    const spreadMean = meanFinite(spreads) ?? 0.6;

    const colScores =
      doc.columns?.length ? doc.columns.map((c) => clamp01(c.confidence.score)) : [];
    const colMean = colScores.length ? meanFinite(colScores)! : rowMean;

    const align = clamp01(doc.debug?.alignment?.score ?? 0.72);
    const cleanAssign = clamp01(doc.debug?.alignment?.cleanAssignmentRatio ?? 0.65);
    const bboxConsistency = blend(align, cleanAssign, 0.42);

    /** Symbol/word/bbox proxies: fixed convex combination (sums to 1). */
    spatialScore =
      0.22 * wordMean +
      0.22 * rowMean +
      0.18 * spreadMean +
      0.18 * colMean +
      0.2 * bboxConsistency;
    spatialScore = clamp01(spatialScore);
  }

  const gstOcrConf =
    params.ocrGstSummary != null &&
    Number.isFinite(params.ocrGstSummary.validation_confidence) ?
      clamp01(params.ocrGstSummary.validation_confidence)
    : null;

  const warnPenalty =
    params.ocrGstSummary ?
      clamp01(Math.max(0, 1 - params.ocrGstSummary.validation_warnings * 0.04))
    : 1;

  if (spatialScore == null && gstOcrConf == null) return roundP(OCR_NEUTRAL);

  if (spatialScore != null && gstOcrConf != null) {
    return roundP(blend(spatialScore, gstOcrConf * warnPenalty, 0.44));
  }
  if (spatialScore != null) return roundP(spatialScore * warnPenalty);
  return roundP((gstOcrConf ?? OCR_NEUTRAL) * warnPenalty);
}

function linePriceMode(priceMode: IndianGstInvoiceExtract['price_mode']): LineCheckerPriceMode {
  return priceMode === 'inclusive' ? 'inclusive' : 'exclusive';
}

export function qtyRateLineConfidenceScore(
  extract: IndianGstInvoiceExtract,
  lineIndex: number,
): number {
  const it = extract.items?.[lineIndex];
  if (!it) return 0.35;

  const qty = it.qty;
  const rate = it.rate;
  const lineTotal = it.line_total;
  const gstRate = it.gst_rate ?? 0;
  const discount = it.discount_amount ?? 0;
  const discInc = Boolean(it.discount_on_tax_inclusive);

  if (
    qty == null ||
    !Number.isFinite(qty) ||
    rate == null ||
    !Number.isFinite(rate) ||
    lineTotal == null ||
    !Number.isFinite(lineTotal)
  ) {
    return 0.42;
  }

  const ctx = {
    qty,
    rate,
    lineTotal,
    gstRatePercent: gstRate,
    discountAmount: discount,
    discountOnTaxInclusive: discInc,
    headerPriceMode: linePriceMode(extract.price_mode),
  };

  const err = lineInclusiveTotalError(ctx);
  const tol = defaultLineTotalTolerance(lineTotal);

  /** Within tolerance → ~1; beyond tolerance ramps down deterministically. */
  return clamp01(1 / (1 + err / Math.max(tol, 1e-6)));
}

function gstLegalConfidence(rate: number | null): number {
  if (rate == null || !Number.isFinite(rate)) return 0.55;
  if (VALID_GST_RATES.has(nearestGstRate(rate))) return 1;
  return isNearLegalGstSlab(rate) ? 0.78 : 0.52;
}

/**
 * Invoice-wide validation pillar (GST coherence, totals, slab math cues).
 */
export function computeInvoiceValidationPillar(
  extract: IndianGstInvoiceExtract,
  propagation: OcrGstPropagationDebug | null,
): number {
  const gstResult = validateGstExtractAgainstOcr(extract, propagation);
  let s = clamp01(gstResult.confidence);

  const wide = scoreInvoiceWideReconciliation(extract);
  const penalty = Math.min(0.28, wide.warnings.length * 0.09);
  s = clamp01(s - penalty);

  const items = extract.items ?? [];
  if (items.length) {
    const lineScores = items.map((_, i) => qtyRateLineConfidenceScore(extract, i));
    const lineMean = meanFinite(lineScores) ?? s;
    s = clamp01(blend(s, lineMean, 0.35));
  }

  const iso = extract.invoice_date ? parseDateToISO(extract.invoice_date) : null;
  if (!iso && extract.invoice_date) s = clamp01(s - 0.12);
  if (extract.grand_total == null || !Number.isFinite(extract.grand_total)) {
    s = clamp01(s - 0.1);
  }

  if (!(extract.gst_summary?.length ?? 0) && items.length > 0) {
    s = clamp01(s - 0.05);
  }

  return roundP(s);
}

/**
 * Field-scoped validation used inside `calculateFieldConfidence`.
 */
export function computeFieldValidationPillar(
  fieldPath: string,
  extract: IndianGstInvoiceExtract,
  propagation: OcrGstPropagationDebug | null,
): number {
  const inv = computeInvoiceValidationPillar(extract, propagation);

  if (fieldPath === 'supplier_gstin' || fieldPath === 'supplier_name') {
    const g = extract.supplier_gstin;
    if (fieldPath === 'supplier_gstin') {
      return g && GSTIN_RE.test(g) ? roundP(blend(inv, 1, 0.55)) : roundP(blend(inv, 0.38, 0.55));
    }
    const name = extract.supplier_name?.trim();
    return name && name.length >= 2 ?
        roundP(blend(inv, 0.92, 0.35))
      : roundP(blend(inv, 0.45, 0.35));
  }

  if (fieldPath === 'buyer_gstin') {
    const g = extract.buyer_gstin;
    return g && GSTIN_RE.test(g) ? roundP(blend(inv, 1, 0.45)) : roundP(blend(inv, 0.42, 0.45));
  }

  if (fieldPath === 'invoice_number') {
    const n = extract.invoice_number?.trim();
    return n && n.length >= 1 ? roundP(blend(inv, 0.95, 0.25)) : roundP(blend(inv, 0.4, 0.25));
  }

  if (fieldPath === 'invoice_date') {
    const iso = extract.invoice_date ? parseDateToISO(extract.invoice_date) : null;
    return iso ? roundP(blend(inv, 1, 0.5)) : roundP(blend(inv, 0.32, 0.5));
  }

  if (fieldPath === 'grand_total') {
    const gt = extract.grand_total;
    return gt != null && Number.isFinite(gt) && gt > 0 ?
        roundP(blend(inv, 1, 0.4))
      : roundP(blend(inv, 0.35, 0.4));
  }

  const m = /^items\.(\d+)\.(.+)$/.exec(fieldPath);
  if (m) {
    const idx = Number(m[1]);
    const sub = m[2];
    const it = extract.items?.[idx];
    if (!it) return roundP(blend(inv, 0.3, 0.5));

    if (sub === 'qty' || sub === 'rate' || sub === 'line_total') {
      const lineQ = qtyRateLineConfidenceScore(extract, idx);
      return roundP(blend(inv, lineQ, 0.55));
    }
    if (sub === 'gst_rate') {
      const g = gstLegalConfidence(it.gst_rate ?? null);
      return roundP(blend(inv, g, 0.45));
    }
    if (sub === 'description' || sub === 'hsn_code') {
      const has = Boolean((sub === 'description' ? it.description : it.hsn_code)?.trim()?.length);
      return has ? roundP(blend(inv, 0.9, 0.2)) : roundP(blend(inv, 0.5, 0.2));
    }
  }

  return inv;
}

export function computeHistoricalPillar(signals: HistoricalConfidenceSignals | null | undefined): number {
  if (!signals) return roundP(HISTORICAL_NEUTRAL);

  const parts: number[] = [];

  if (signals.layoutSampleSize > 0) {
    if (signals.layoutAcceptanceRate != null && Number.isFinite(signals.layoutAcceptanceRate)) {
      parts.push(clamp01(signals.layoutAcceptanceRate));
    }
    if (signals.layoutCorrectionRate != null && Number.isFinite(signals.layoutCorrectionRate)) {
      parts.push(clamp01(1 - signals.layoutCorrectionRate));
    }
    if (signals.layoutAvgConfidence != null && Number.isFinite(signals.layoutAvgConfidence)) {
      parts.push(clamp01(signals.layoutAvgConfidence));
    }
  }

  if (signals.vendorSampleSize > 0) {
    if (signals.vendorCorrectionRate != null && Number.isFinite(signals.vendorCorrectionRate)) {
      parts.push(clamp01(1 - signals.vendorCorrectionRate));
    }
    if (signals.vendorAvgConfidence != null && Number.isFinite(signals.vendorAvgConfidence)) {
      parts.push(clamp01(signals.vendorAvgConfidence));
    }
  }

  const m = meanFinite(parts);
  return roundP(m ?? HISTORICAL_NEUTRAL);
}

export function computeHistoricalFieldPillar(
  fieldLearningKey: string | null,
  invoiceHistorical: number,
  signals: HistoricalConfidenceSignals | null | undefined,
): number {
  if (!signals?.fieldCorrectionRates || !fieldLearningKey) return invoiceHistorical;
  const rate = signals.fieldCorrectionRates[fieldLearningKey];
  if (rate == null || !Number.isFinite(rate)) return invoiceHistorical;
  const fieldPrior = clamp01(1 - clamp01(rate));
  return roundP(blend(invoiceHistorical, fieldPrior, 0.35));
}

/**
 * Duplicate / header / structural agreement — pure heuristics on the extract (+ optional semantics).
 */
export function computeSemanticPillar(
  extract: IndianGstInvoiceExtract,
  semanticLines: SemanticInvoiceLineLike[] | null | undefined,
  headerAlignmentScore: number | null | undefined,
): number {
  let s = SEMANTIC_NEUTRAL_BASE;

  if (extract.tax_type) s += 0.06;
  if (extract.price_mode) s += 0.06;
  if ((extract.items?.length ?? 0) > 0) s += 0.08;
  if (extract.grand_total != null && extract.subtotal != null) s += 0.04;

  const supState = gstinStateCode(extract.supplier_gstin);
  const posRaw = (extract.place_of_supply ?? '').trim();
  const posNorm = /^\d{2}$/.test(posRaw) ? posRaw : '';
  if (supState && posNorm && supState !== posNorm) s -= 0.06;

  if (
    extract.supplier_gstin &&
    extract.buyer_gstin &&
    extract.supplier_gstin !== extract.buyer_gstin
  ) {
    s += 0.03;
  }

  const header = headerAlignmentScore != null ? clamp01(headerAlignmentScore) : null;
  const semMean =
    semanticLines?.length ?
      meanFinite(semanticLines.map((l) => clamp01(l.confidence)))
    : null;

  const semQuality =
    semMean != null && header != null ? blend(semMean, header, 0.35)
    : semMean != null ? semMean
    : header;

  if (semQuality != null) s = blend(s, semQuality, 0.45);

  if (semanticLines?.length) {
    const ok = semanticLines.filter(
      (l) => l.validation?.quantityRateAmountConsistent !== false,
    ).length;
    const ratio = ok / semanticLines.length;
    s = blend(s, 0.5 + ratio * 0.5, 0.22);
    const susp = semanticLines.filter((l) => l.validation?.suspicious).length;
    s = clamp01(s - Math.min(0.18, (susp / semanticLines.length) * 0.25));
  }

  return roundP(clamp01(s));
}
