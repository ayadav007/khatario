import { query, queryOne, queryRows } from '@/lib/db';
import { computeProRataMonthlySalary, type ProRataSalaryResult } from '@/lib/hr/salary-payroll-helpers';
import {
  ensureDefaultSalaryComponents,
  legacyStructureToLineInputs,
  linesToLegacyColumns,
  listSalaryComponents,
  replaceStructureLines,
  type StructureLineInput,
} from '@/lib/hr/salary-components';

export type SalaryStructureInput = {
  business_id: string;
  employee_id: string;
  basic_salary: number;
  hra?: number;
  transport_allowance?: number;
  medical_allowance?: number;
  special_allowance?: number;
  other_allowances?: number;
  pf_percentage?: number;
  pf_fixed_amount?: number | null;
  professional_tax?: number;
  tds_percentage?: number;
  other_deductions?: number;
  effective_from: string;
  notes?: string | null;
  /** Optional catalog lines — when set, legacy columns are derived from these. */
  lines?: StructureLineInput[];
};

export type OfferSalarySnapshot = {
  basic_salary: number;
  hra: number;
  transport_allowance: number;
  medical_allowance: number;
  special_allowance: number;
  other_allowances: number;
  pf_percentage: number;
  pf_fixed_amount: number | null;
  professional_tax: number;
  tds_percentage: number;
  other_deductions: number;
};

export function grossFromComponents(c: OfferSalarySnapshot): number {
  return (
    Number(c.basic_salary) +
    Number(c.hra) +
    Number(c.transport_allowance) +
    Number(c.medical_allowance) +
    Number(c.special_allowance) +
    Number(c.other_allowances)
  );
}

export async function getActiveSalaryStructure(
  employeeId: string,
  businessId: string,
  asOf?: string,
): Promise<Record<string, unknown> | null> {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  return queryOne(
    `SELECT * FROM salary_structures
     WHERE employee_id = $1 AND business_id = $2
       AND effective_from <= $3::date
       AND (effective_to IS NULL OR effective_to >= $3::date)
     ORDER BY effective_from DESC
     LIMIT 1`,
    [employeeId, businessId, date],
  );
}

export async function createSalaryStructure(input: SalaryStructureInput): Promise<{ id: string }> {
  const effectiveFrom = input.effective_from.slice(0, 10);
  const prevDay = new Date(`${effectiveFrom}T12:00:00`);
  prevDay.setDate(prevDay.getDate() - 1);
  const prevDayStr = prevDay.toISOString().slice(0, 10);

  await ensureDefaultSalaryComponents(input.business_id);
  const catalog = await listSalaryComponents(input.business_id, { activeOnly: false });

  let resolved = { ...input };
  if (input.lines && input.lines.length > 0) {
    const cols = linesToLegacyColumns(input.lines, catalog);
    resolved = {
      ...input,
      basic_salary: Number(cols.basic_salary || 0),
      hra: Number(cols.hra || 0),
      transport_allowance: Number(cols.transport_allowance || 0),
      medical_allowance: Number(cols.medical_allowance || 0),
      special_allowance: Number(cols.special_allowance || 0),
      other_allowances: Number(cols.other_allowances || 0),
      pf_percentage: Number(cols.pf_percentage ?? 12),
      pf_fixed_amount: cols.pf_fixed_amount != null ? Number(cols.pf_fixed_amount) : null,
      professional_tax: Number(cols.professional_tax || 0),
      tds_percentage: Number(cols.tds_percentage || 0),
      other_deductions: Number(cols.other_deductions || 0),
    };
  }

  if (!(resolved.basic_salary > 0)) {
    throw new Error('basic_salary must be greater than 0');
  }

  await query(
    `UPDATE salary_structures
     SET effective_to = $1, updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $2 AND business_id = $3 AND effective_to IS NULL AND effective_from < $4::date`,
    [prevDayStr, input.employee_id, input.business_id, effectiveFrom],
  );

  const row = await queryOne<{ id: string }>(
    `INSERT INTO salary_structures (
      business_id, employee_id, basic_salary, hra, transport_allowance, medical_allowance,
      special_allowance, other_allowances, pf_percentage, pf_fixed_amount, professional_tax,
      tds_percentage, other_deductions, effective_from, effective_to, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::date,NULL,$15)
    RETURNING id`,
    [
      input.business_id,
      input.employee_id,
      resolved.basic_salary,
      resolved.hra ?? 0,
      resolved.transport_allowance ?? 0,
      resolved.medical_allowance ?? 0,
      resolved.special_allowance ?? 0,
      resolved.other_allowances ?? 0,
      resolved.pf_percentage ?? 12,
      resolved.pf_fixed_amount ?? null,
      resolved.professional_tax ?? 0,
      resolved.tds_percentage ?? 0,
      resolved.other_deductions ?? 0,
      effectiveFrom,
      input.notes ?? null,
    ],
  );

  if (!row) throw new Error('Failed to create salary structure');

  const lineInputs =
    input.lines && input.lines.length > 0
      ? input.lines
      : legacyStructureToLineInputs(
          {
            basic_salary: resolved.basic_salary,
            hra: resolved.hra ?? 0,
            transport_allowance: resolved.transport_allowance ?? 0,
            medical_allowance: resolved.medical_allowance ?? 0,
            special_allowance: resolved.special_allowance ?? 0,
            other_allowances: resolved.other_allowances ?? 0,
            pf_percentage: resolved.pf_percentage ?? 12,
            pf_fixed_amount: resolved.pf_fixed_amount ?? null,
            professional_tax: resolved.professional_tax ?? 0,
            tds_percentage: resolved.tds_percentage ?? 0,
            other_deductions: resolved.other_deductions ?? 0,
          },
          catalog,
        );
  await replaceStructureLines(row.id, lineInputs);

  const gross = grossFromComponents({
    basic_salary: resolved.basic_salary,
    hra: resolved.hra ?? 0,
    transport_allowance: resolved.transport_allowance ?? 0,
    medical_allowance: resolved.medical_allowance ?? 0,
    special_allowance: resolved.special_allowance ?? 0,
    other_allowances: resolved.other_allowances ?? 0,
    pf_percentage: resolved.pf_percentage ?? 12,
    pf_fixed_amount: resolved.pf_fixed_amount ?? null,
    professional_tax: resolved.professional_tax ?? 0,
    tds_percentage: resolved.tds_percentage ?? 0,
    other_deductions: resolved.other_deductions ?? 0,
  });

  await query(
    `UPDATE employees SET salary = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND business_id = $3`,
    [gross, input.employee_id, input.business_id],
  );

  return row;
}

export async function listSalaryStructureHistory(
  employeeId: string,
  businessId: string,
): Promise<Record<string, unknown>[]> {
  return queryRows(
    `SELECT * FROM salary_structures
     WHERE employee_id = $1 AND business_id = $2
     ORDER BY effective_from DESC`,
    [employeeId, businessId],
  );
}

export function salaryStructureFromOffer(
  offer: Record<string, unknown>,
  employeeId: string,
  businessId: string,
): SalaryStructureInput {
  const joining = String(offer.joining_date).slice(0, 10);
  return {
    business_id: businessId,
    employee_id: employeeId,
    basic_salary: Number(offer.basic_salary),
    hra: Number(offer.hra ?? 0),
    transport_allowance: Number(offer.transport_allowance ?? 0),
    medical_allowance: Number(offer.medical_allowance ?? 0),
    special_allowance: Number(offer.special_allowance ?? 0),
    other_allowances: Number(offer.other_allowances ?? 0),
    pf_percentage: Number(offer.pf_percentage ?? 12),
    pf_fixed_amount: offer.pf_fixed_amount != null ? Number(offer.pf_fixed_amount) : null,
    professional_tax: Number(offer.professional_tax ?? 0),
    tds_percentage: Number(offer.tds_percentage ?? 0),
    other_deductions: Number(offer.other_deductions ?? 0),
    effective_from: joining,
    notes: 'Created from accepted offer letter on joining',
  };
}

/** Prefill payroll payment fields from active structure (pro-rata applied separately). */
export function payrollPrefillFromStructure(structure: Record<string, unknown>) {
  const basic = Number(structure.basic_salary ?? 0);
  const pfPct = Number(structure.pf_percentage ?? 0);
  const pfFixed = structure.pf_fixed_amount != null ? Number(structure.pf_fixed_amount) : null;
  const gross =
    basic +
    Number(structure.hra ?? 0) +
    Number(structure.transport_allowance ?? 0) +
    Number(structure.medical_allowance ?? 0) +
    Number(structure.special_allowance ?? 0) +
    Number(structure.other_allowances ?? 0);
  const pf = pfFixed != null ? pfFixed : Math.round((basic * pfPct) / 100 * 100) / 100;
  const tdsPct = Number(structure.tds_percentage ?? 0);
  const tds = Math.round((gross * tdsPct) / 100 * 100) / 100;

  return {
    basic_salary: basic,
    hra: Number(structure.hra ?? 0),
    transport_allowance: Number(structure.transport_allowance ?? 0),
    medical_allowance: Number(structure.medical_allowance ?? 0),
    special_allowance: Number(structure.special_allowance ?? 0),
    other_earnings: Number(structure.other_allowances ?? 0),
    provident_fund: pf,
    professional_tax: Number(structure.professional_tax ?? 0),
    tds,
    other_deductions: Number(structure.other_deductions ?? 0),
    gross_monthly: gross,
  };
}

function scaleAmount(amount: number, factor: number): number {
  return Math.round(amount * factor * 100) / 100;
}

/** Prefill payroll fields from structure, with pro-rata on earnings when joining mid-period. */
export function payrollPrefillWithProRata(
  structure: Record<string, unknown>,
  periodFrom: string,
  periodTo: string,
  joiningDate?: string | null,
): {
  fields: ReturnType<typeof payrollPrefillFromStructure>;
  proRata: ProRataSalaryResult;
  from_structure: true;
} {
  const base = payrollPrefillFromStructure(structure);
  const proRata = computeProRataMonthlySalary({
    monthlySalary: base.gross_monthly,
    periodFrom,
    periodTo,
    joiningDate,
  });

  const factor =
    proRata.fullMonthlySalary > 0 ? proRata.proratedAmount / proRata.fullMonthlySalary : 1;

  const basic_salary = scaleAmount(base.basic_salary, factor);
  const hra = scaleAmount(base.hra, factor);
  const transport_allowance = scaleAmount(base.transport_allowance, factor);
  const medical_allowance = scaleAmount(base.medical_allowance, factor);
  const special_allowance = scaleAmount(base.special_allowance, factor);
  const other_earnings = scaleAmount(base.other_earnings, factor);

  const scaledGross =
    basic_salary + hra + transport_allowance + medical_allowance + special_allowance + other_earnings;

  const pfPct = Number(structure.pf_percentage ?? 0);
  const pfFixed = structure.pf_fixed_amount != null ? Number(structure.pf_fixed_amount) : null;
  const provident_fund =
    pfFixed != null
      ? scaleAmount(pfFixed, factor)
      : Math.round((basic_salary * pfPct) / 100 * 100) / 100;

  const tdsPct = Number(structure.tds_percentage ?? 0);
  const tds = Math.round((scaledGross * tdsPct) / 100 * 100) / 100;

  return {
    fields: {
      basic_salary,
      hra,
      transport_allowance,
      medical_allowance,
      special_allowance,
      other_earnings,
      provident_fund,
      professional_tax: proRata.applied ? scaleAmount(base.professional_tax, factor) : base.professional_tax,
      tds,
      other_deductions: proRata.applied ? scaleAmount(base.other_deductions, factor) : base.other_deductions,
      gross_monthly: scaledGross,
    },
    proRata,
    from_structure: true,
  };
}
