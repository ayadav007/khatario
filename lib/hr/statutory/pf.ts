/**
 * EPF (simplified): employee + employer % on PF wages,
 * capped at business wage ceiling (default ₹15,000 on Basic).
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computePfContribution(args: {
  enabled: boolean;
  applicable: boolean;
  basic: number;
  employeeRate: number;
  employerRate: number;
  wageCeiling: number;
  fixedAmount?: number | null;
}): {
  pfWage: number;
  employee: number;
  employer: number;
  source: 'fixed' | 'percent' | 'disabled' | 'not_applicable';
} {
  if (!args.enabled) {
    return { pfWage: 0, employee: 0, employer: 0, source: 'disabled' };
  }
  if (!args.applicable) {
    return { pfWage: 0, employee: 0, employer: 0, source: 'not_applicable' };
  }

  const basic = Math.max(0, Number(args.basic) || 0);
  const ceiling = Math.max(0, Number(args.wageCeiling) || 0);
  const pfWage = ceiling > 0 ? Math.min(basic, ceiling) : basic;

  if (args.fixedAmount != null && Number.isFinite(Number(args.fixedAmount))) {
    const employee = round2(Math.max(0, Number(args.fixedAmount)));
    const employerRate = Math.max(0, Number(args.employerRate) || 0);
    const employer = round2((pfWage * employerRate) / 100);
    return { pfWage: round2(pfWage), employee, employer, source: 'fixed' };
  }

  const employeeRate = Math.max(0, Number(args.employeeRate) || 0);
  const employerRate = Math.max(0, Number(args.employerRate) || 0);
  return {
    pfWage: round2(pfWage),
    employee: round2((pfWage * employeeRate) / 100),
    employer: round2((pfWage * employerRate) / 100),
    source: 'percent',
  };
}
