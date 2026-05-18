import type { ConfidenceBreakdown4, InvoiceReviewStatus } from './types';
import { getConfidenceWeights, getConfidenceThresholds } from './env';
import { clamp01, round4 } from './math';

export function combineConfidenceBreakdown(parts: ConfidenceBreakdown4): number {
  const w = getConfidenceWeights();
  const raw =
    w.ocr * parts.ocr +
    w.validation * parts.validation +
    w.historical * parts.historical +
    w.semantic * parts.semantic;
  return round4(clamp01(raw));
}

export function classifyInvoiceStatus(score: number): InvoiceReviewStatus {
  const { autoAcceptMin, reviewRequiredMin } = getConfidenceThresholds();
  if (score >= autoAcceptMin) return 'AUTO_ACCEPT';
  if (score >= reviewRequiredMin) return 'REVIEW_REQUIRED';
  return 'LOW_CONFIDENCE';
}
