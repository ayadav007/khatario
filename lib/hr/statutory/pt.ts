/**
 * Professional Tax — simplified monthly slabs by state.
 * Structure-level fixed PT always wins when provided.
 */

import type { PtStateCode } from './types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Approximate monthly PT for common states (SME-friendly defaults). */
export function computeProfessionalTaxFromSlab(
  state: PtStateCode | null | undefined,
  monthlyGross: number,
): number {
  const gross = Math.max(0, Number(monthlyGross) || 0);
  if (!state || state === 'OTHER') return 0;

  switch (state) {
    case 'MH':
      // Maharashtra (simplified): ≤7500 → 0; ≤10000 → 175; else 200
      if (gross <= 7500) return 0;
      if (gross <= 10000) return 175;
      return 200;
    case 'KA':
      // Karnataka: ≤15000 → 0; else 200
      if (gross <= 15000) return 0;
      return 200;
    case 'WB':
      // West Bengal (simplified mid-band)
      if (gross <= 10000) return 0;
      if (gross <= 15000) return 110;
      if (gross <= 25000) return 130;
      if (gross <= 40000) return 150;
      return 200;
    case 'TN':
      if (gross <= 21000) return 0;
      return 208; // ~₹2500/year ≈ 208/month simplified
    case 'GJ':
      if (gross <= 12000) return 0;
      return 200;
    case 'DL':
      // Delhi abolished PT for most — keep 0
      return 0;
    default:
      return 0;
  }
}

export function resolveProfessionalTax(args: {
  enabled: boolean;
  state: PtStateCode | null;
  gross: number;
  fixedAmount?: number | null;
}): { amount: number; source: 'fixed' | 'slab' | 'disabled' } {
  if (!args.enabled) {
    return { amount: 0, source: 'disabled' };
  }
  if (args.fixedAmount != null && Number(args.fixedAmount) > 0) {
    return { amount: round2(Number(args.fixedAmount)), source: 'fixed' };
  }
  return {
    amount: round2(computeProfessionalTaxFromSlab(args.state, args.gross)),
    source: 'slab',
  };
}
