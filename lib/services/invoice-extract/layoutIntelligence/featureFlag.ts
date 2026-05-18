const TRUE = new Set(['1', 'true', 'yes']);

export function invoiceLayoutIntelligenceEnabled(): boolean {
  const v = (process.env.INVOICE_LAYOUT_INTELLIGENCE ?? 'false').trim().toLowerCase();
  return TRUE.has(v);
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function layoutHighConfidenceAcceptanceMin(): number {
  return Math.min(1, Math.max(0, numEnv('INVOICE_LAYOUT_HIGH_CONFIDENCE_ACCEPTANCE_MIN', 0.88)));
}

export function layoutMinSamplesForSignals(): number {
  return Math.max(0, Math.trunc(numEnv('INVOICE_LAYOUT_MIN_SAMPLES', 5)));
}
