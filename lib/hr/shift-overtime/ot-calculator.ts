import { queryOne } from '@/lib/db';
import { getOtPolicyBundle, detectOtScenario } from '@/lib/hr/shift-overtime/ot-policy';

export async function computeOtMonetaryAmount(input: {
  businessId: string;
  employeeId: string;
  requestDate: string;
  durationMinutes: number;
  excludeBreakMinutes?: number;
}): Promise<number> {
  const { rules } = await getOtPolicyBundle(input.businessId);
  const scenario = await detectOtScenario(input.businessId, input.employeeId, input.requestDate);
  const rule = rules.find((r) => r.scenario === scenario);
  if (!rule) return 0;

  let minutes = input.durationMinutes;
  if (rule.exclude_break && input.excludeBreakMinutes) {
    minutes = Math.max(0, minutes - input.excludeBreakMinutes);
  }
  if (minutes < rule.min_minutes) return 0;

  const hours = minutes / 60;

  if (rule.pay_mode === 'fixed_lump') {
    return Math.round(Number(rule.fixed_amount ?? 0) * 100) / 100;
  }

  const structure = await queryOne<{
    basic_salary: string;
    hra: string;
    transport_allowance: string;
    medical_allowance: string;
    special_allowance: string;
    other_allowances: string;
  }>(
    `SELECT basic_salary, hra, transport_allowance, medical_allowance, special_allowance, other_allowances
     FROM salary_structures
     WHERE business_id = $1 AND employee_id = $2
       AND effective_from <= $3::date
       AND (effective_to IS NULL OR effective_to >= $3::date)
     ORDER BY effective_from DESC LIMIT 1`,
    [input.businessId, input.employeeId, input.requestDate],
  );

  if (!structure) return 0;

  const gross =
    Number(structure.basic_salary ?? 0) +
    Number(structure.hra ?? 0) +
    Number(structure.transport_allowance ?? 0) +
    Number(structure.medical_allowance ?? 0) +
    Number(structure.special_allowance ?? 0) +
    Number(structure.other_allowances ?? 0);

  const hourlyRate = gross / 30 / 8;
  const amount = hourlyRate * hours * Number(rule.multiplier ?? 1);
  return Math.round(amount * 100) / 100;
}

export async function computeOtCompOffDays(input: {
  businessId: string;
  employeeId: string;
  requestDate: string;
  durationMinutes: number;
}): Promise<number> {
  const { rules } = await getOtPolicyBundle(input.businessId);
  const scenario = await detectOtScenario(input.businessId, input.employeeId, input.requestDate);
  const rule = rules.find((r) => r.scenario === scenario);
  if (!rule) return 0;
  if (input.durationMinutes < rule.min_minutes) return 0;
  return rule.comp_off_days;
}
