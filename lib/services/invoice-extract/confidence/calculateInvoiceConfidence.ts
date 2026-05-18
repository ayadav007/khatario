import type { IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';

import { calculateTableConfidence } from './calculateTableConfidence';
import { classifyInvoiceStatus, combineConfidenceBreakdown } from './combine';
import { calculateFieldConfidence } from './calculateFieldConfidence';
import type {
  HistoricalConfidenceSignals,
  InvoiceCompositeConfidence,
  InvoiceConfidenceContext,
} from './types';
import {
  computeHistoricalPillar,
  computeInvoiceValidationPillar,
  computeOcrPillar,
  computeSemanticPillar,
} from './scores';

/**
 * Invoice-level pillars + review status (+ optional drill-down for table / key headers).
 */
export function calculateInvoiceConfidence(
  extract: IndianGstInvoiceExtract,
  ctx: InvoiceConfidenceContext,
): InvoiceCompositeConfidence {
  const ocr = computeOcrPillar({ spatial: ctx.spatial, ocrGstSummary: ctx.ocrGstSummary });
  const validation = computeInvoiceValidationPillar(extract, ctx.gstPropagation ?? null);
  const historical = computeHistoricalPillar(ctx.historical);
  const semantic = computeSemanticPillar(
    extract,
    ctx.semanticLines ?? undefined,
    ctx.headerAlignmentScore ?? undefined,
  );

  const confidence_breakdown = { ocr, validation, historical, semantic };
  const confidence = combineConfidenceBreakdown(confidence_breakdown);

  const table = calculateTableConfidence(extract, ctx);

  const fields = {
    supplier_gstin: calculateFieldConfidence(
      'supplier_gstin',
      extract.supplier_gstin,
      extract,
      ctx,
    ),
    invoice_date: calculateFieldConfidence('invoice_date', extract.invoice_date, extract, ctx),
    grand_total: calculateFieldConfidence('grand_total', extract.grand_total, extract, ctx),
  };

  const status = classifyInvoiceStatus(confidence);

  return {
    confidence,
    status,
    confidence_breakdown,
    fields,
    table,
  };
}

/** Pure merge for tests / callers that assemble historical without DB I/O. */
export function mergeHistoricalSignals(
  base: HistoricalConfidenceSignals,
  patch: Partial<HistoricalConfidenceSignals>,
): HistoricalConfidenceSignals {
  return {
    ...base,
    ...patch,
    fieldCorrectionRates: {
      ...base.fieldCorrectionRates,
      ...(patch.fieldCorrectionRates ?? {}),
    },
  };
}
