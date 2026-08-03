/**
 * ESIC (simplified): employee + employer % of gross when gross ≤ wage ceiling.
 * Above ceiling → not covered (0).
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeEsiContribution(args: {
  enabled: boolean;
  applicable: boolean;
  gross: number;
  employeeRate: number;
  employerRate: number;
  wageCeiling: number;
}): {
  esiWage: number;
  employee: number;
  employer: number;
  source: 'percent' | 'above_ceiling' | 'disabled' | 'not_applicable';
} {
  if (!args.enabled) {
    return { esiWage: 0, employee: 0, employer: 0, source: 'disabled' };
  }
  if (!args.applicable) {
    return { esiWage: 0, employee: 0, employer: 0, source: 'not_applicable' };
  }

  const gross = Math.max(0, Number(args.gross) || 0);
  const ceiling = Math.max(0, Number(args.wageCeiling) || 0);

  if (ceiling > 0 && gross > ceiling) {
    return { esiWage: round2(gross), employee: 0, employer: 0, source: 'above_ceiling' };
  }

  const employeeRate = Math.max(0, Number(args.employeeRate) || 0);
  const employerRate = Math.max(0, Number(args.employerRate) || 0);
  return {
    esiWage: round2(gross),
    employee: round2((gross * employeeRate) / 100),
    employer: round2((gross * employerRate) / 100),
    source: 'percent',
  };
}
