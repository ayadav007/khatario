import { computePfContribution } from './pf';
import { computeEsiContribution } from './esi';
import { resolveProfessionalTax } from './pt';
import type { StatutoryCalcInput, StatutoryCalcResult } from './types';

export type {
  PtStateCode,
  StatutoryPayrollSettings,
  StatutoryCalcInput,
  StatutoryCalcResult,
} from './types';
export { computePfContribution } from './pf';
export { computeEsiContribution } from './esi';
export { resolveProfessionalTax, computeProfessionalTaxFromSlab } from './pt';

export function calculateStatutory(input: StatutoryCalcInput): StatutoryCalcResult {
  const { settings } = input;
  const pf = computePfContribution({
    enabled: settings.pf_enabled,
    applicable: input.pfApplicable !== false,
    basic: input.basic,
    employeeRate: settings.pf_employee_rate,
    employerRate: settings.pf_employer_rate,
    wageCeiling: settings.pf_wage_ceiling,
    fixedAmount: input.pfFixedAmount,
  });

  const esi = computeEsiContribution({
    enabled: settings.esi_enabled,
    applicable: input.esiApplicable !== false,
    gross: input.gross,
    employeeRate: settings.esi_employee_rate,
    employerRate: settings.esi_employer_rate,
    wageCeiling: settings.esi_wage_ceiling,
  });

  const pt = resolveProfessionalTax({
    enabled: settings.pt_enabled,
    state: settings.pt_state,
    gross: input.gross,
    fixedAmount: input.professionalTaxFixed,
  });

  return {
    pf_wage: pf.pfWage,
    provident_fund: pf.employee,
    employer_provident_fund: pf.employer,
    esi_wage: esi.esiWage,
    esi_employee: esi.employee,
    esi_employer: esi.employer,
    professional_tax: pt.amount,
    breakdown: {
      pf_enabled: settings.pf_enabled,
      pf_employee_rate: settings.pf_employee_rate,
      pf_employer_rate: settings.pf_employer_rate,
      pf_wage_ceiling: settings.pf_wage_ceiling,
      pf_source: pf.source,
      esi_enabled: settings.esi_enabled,
      esi_employee_rate: settings.esi_employee_rate,
      esi_employer_rate: settings.esi_employer_rate,
      esi_wage_ceiling: settings.esi_wage_ceiling,
      esi_source: esi.source,
      pt_enabled: settings.pt_enabled,
      pt_state: settings.pt_state,
      pt_source: pt.source,
    },
  };
}
