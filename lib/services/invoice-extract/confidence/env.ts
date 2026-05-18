/**
 * Feature flag + tunable weights / thresholds (env-driven, deterministic defaults).
 */

const TRUE = new Set(['1', 'true', 'yes']);

export function invoiceConfidenceEngineEnabled(): boolean {
  const v = (process.env.INVOICE_CONFIDENCE_ENGINE ?? 'false').trim().toLowerCase();
  return TRUE.has(v);
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Weights for ocr, validation, historical, semantic — must sum to 1 after normalization. */
export function getConfidenceWeights(): { ocr: number; validation: number; historical: number; semantic: number } {
  const ocr = numEnv('INVOICE_CONFIDENCE_WEIGHT_OCR', 0.25);
  const validation = numEnv('INVOICE_CONFIDENCE_WEIGHT_VALIDATION', 0.35);
  const historical = numEnv('INVOICE_CONFIDENCE_WEIGHT_HISTORICAL', 0.2);
  const semantic = numEnv('INVOICE_CONFIDENCE_WEIGHT_SEMANTIC', 0.2);
  const sum = ocr + validation + historical + semantic;
  if (sum <= 0) return { ocr: 0.25, validation: 0.35, historical: 0.2, semantic: 0.2 };
  return {
    ocr: ocr / sum,
    validation: validation / sum,
    historical: historical / sum,
    semantic: semantic / sum,
  };
}

export function getConfidenceThresholds(): { autoAcceptMin: number; reviewRequiredMin: number } {
  return {
    autoAcceptMin: numEnv('INVOICE_CONFIDENCE_AUTO_ACCEPT_MIN', 0.86),
    reviewRequiredMin: numEnv('INVOICE_CONFIDENCE_REVIEW_REQUIRED_MIN', 0.55),
  };
}
