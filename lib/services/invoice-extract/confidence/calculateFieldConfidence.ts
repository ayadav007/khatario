import type { IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';

import { combineConfidenceBreakdown } from './combine';
import {
  computeOcrPillar,
  computeFieldValidationPillar,
  computeHistoricalPillar,
  computeHistoricalFieldPillar,
  computeSemanticPillar,
} from './scores';
import type { FieldConfidenceResult, InvoiceConfidenceContext } from './types';
import { fieldPathToLearningKey } from './fieldPathLearningKey';

/**
 * Composite confidence for a single logical field (deterministic pillars).
 */
export function calculateFieldConfidence<T>(
  fieldPath: string,
  value: T,
  extract: IndianGstInvoiceExtract,
  ctx: InvoiceConfidenceContext,
): FieldConfidenceResult<T> {
  const ocr = computeOcrPillar({ spatial: ctx.spatial, ocrGstSummary: ctx.ocrGstSummary });

  const validation = computeFieldValidationPillar(fieldPath, extract, ctx.gstPropagation ?? null);

  const histBase = computeHistoricalPillar(ctx.historical);
  const historical = computeHistoricalFieldPillar(
    fieldPathToLearningKey(fieldPath),
    histBase,
    ctx.historical,
  );

  const semantic = computeSemanticPillar(
    extract,
    ctx.semanticLines ?? undefined,
    ctx.headerAlignmentScore ?? undefined,
  );

  const confidence_breakdown = { ocr, validation, historical, semantic };
  return {
    value,
    confidence: combineConfidenceBreakdown(confidence_breakdown),
    confidence_breakdown,
  };
}
