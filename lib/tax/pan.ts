const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function normalizePan(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const pan = value.trim().toUpperCase();
  return PAN_RE.test(pan) ? pan : null;
}

/** Characters 3–12 of a GSTIN are the holder's PAN. */
export function panFromGstin(gstin: unknown): string | null {
  if (typeof gstin !== 'string' || gstin.trim().length !== 15) return null;
  return normalizePan(gstin.trim().toUpperCase().slice(2, 12));
}

/**
 * s.206AA: without the deductee's PAN, TDS is the higher of the section rate and 20%
 * (5% for s.194Q purchases and s.194O e-commerce, per the proviso).
 */
export function tdsRateWithoutPan(sectionCode: string, sectionRate: number): number {
  const floor = /^194(Q|O)$/i.test(sectionCode.trim()) ? 5 : 20;
  return Math.max(sectionRate, floor);
}
