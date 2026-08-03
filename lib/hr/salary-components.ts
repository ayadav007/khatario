/**
 * Business salary component catalog + structure lines.
 * System keys keep legacy salary_structures columns in sync for payroll/statutory.
 */

import { query, queryOne, queryRows } from '@/lib/db';

export type SalaryComponentType = 'earning' | 'deduction';
export type SalaryCalcType = 'fixed' | 'percent_basic' | 'percent_gross';

export type SalaryComponentDefinition = {
  id: string;
  business_id: string;
  code: string;
  name: string;
  component_type: SalaryComponentType;
  calculation_type: SalaryCalcType;
  system_key: string | null;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
};

export type StructureLineInput = {
  component_id: string;
  value: number;
};

export type ResolvedComponentLine = {
  component_id: string;
  code: string;
  name: string;
  component_type: SalaryComponentType;
  calculation_type: SalaryCalcType;
  system_key: string | null;
  value: number;
  amount: number;
};

const DEFAULT_COMPONENTS: Array<{
  code: string;
  name: string;
  component_type: SalaryComponentType;
  calculation_type: SalaryCalcType;
  system_key: string | null;
  sort_order: number;
}> = [
  { code: 'BASIC', name: 'Basic', component_type: 'earning', calculation_type: 'fixed', system_key: 'basic_salary', sort_order: 10 },
  { code: 'HRA', name: 'HRA', component_type: 'earning', calculation_type: 'fixed', system_key: 'hra', sort_order: 20 },
  { code: 'TRANSPORT', name: 'Transport allowance', component_type: 'earning', calculation_type: 'fixed', system_key: 'transport_allowance', sort_order: 30 },
  { code: 'MEDICAL', name: 'Medical allowance', component_type: 'earning', calculation_type: 'fixed', system_key: 'medical_allowance', sort_order: 40 },
  { code: 'SPECIAL', name: 'Special allowance', component_type: 'earning', calculation_type: 'fixed', system_key: 'special_allowance', sort_order: 50 },
  { code: 'OTHER_EARN', name: 'Other allowances', component_type: 'earning', calculation_type: 'fixed', system_key: 'other_allowances', sort_order: 60 },
  { code: 'PF', name: 'Provident Fund', component_type: 'deduction', calculation_type: 'percent_basic', system_key: 'pf_percentage', sort_order: 110 },
  { code: 'PT', name: 'Professional Tax', component_type: 'deduction', calculation_type: 'fixed', system_key: 'professional_tax', sort_order: 120 },
  { code: 'TDS', name: 'TDS', component_type: 'deduction', calculation_type: 'percent_gross', system_key: 'tds_percentage', sort_order: 130 },
  { code: 'OTHER_DED', name: 'Other deductions', component_type: 'deduction', calculation_type: 'fixed', system_key: 'other_deductions', sort_order: 140 },
];

export async function ensureDefaultSalaryComponents(businessId: string): Promise<void> {
  for (const c of DEFAULT_COMPONENTS) {
    await query(
      `INSERT INTO salary_component_definitions (
         business_id, code, name, component_type, calculation_type, system_key, is_system, sort_order
       ) VALUES ($1, $2, $3, $4, $5, $6, true, $7)
       ON CONFLICT (business_id, code) DO NOTHING`,
      [businessId, c.code, c.name, c.component_type, c.calculation_type, c.system_key, c.sort_order],
    );
  }
}

export async function listSalaryComponents(
  businessId: string,
  opts?: { activeOnly?: boolean },
): Promise<SalaryComponentDefinition[]> {
  await ensureDefaultSalaryComponents(businessId);
  const activeOnly = opts?.activeOnly !== false;
  return queryRows<SalaryComponentDefinition>(
    `SELECT id, business_id, code, name, component_type, calculation_type, system_key,
            is_system, is_active, sort_order
     FROM salary_component_definitions
     WHERE business_id = $1
       ${activeOnly ? 'AND is_active = true' : ''}
     ORDER BY sort_order ASC, name ASC`,
    [businessId],
  );
}

export async function createSalaryComponent(
  businessId: string,
  input: {
    code: string;
    name: string;
    component_type: SalaryComponentType;
    calculation_type?: SalaryCalcType;
    sort_order?: number;
  },
): Promise<SalaryComponentDefinition> {
  await ensureDefaultSalaryComponents(businessId);
  const code = input.code.trim().toUpperCase().replace(/\s+/g, '_').slice(0, 40);
  const name = input.name.trim().slice(0, 120);
  if (!code || !name) throw new Error('code and name are required');
  if (!['earning', 'deduction'].includes(input.component_type)) {
    throw new Error('component_type must be earning or deduction');
  }
  const calc = input.calculation_type ?? 'fixed';
  const row = await queryOne<SalaryComponentDefinition>(
    `INSERT INTO salary_component_definitions (
       business_id, code, name, component_type, calculation_type, is_system, sort_order
     ) VALUES ($1, $2, $3, $4, $5, false, $6)
     RETURNING id, business_id, code, name, component_type, calculation_type, system_key,
               is_system, is_active, sort_order`,
    [businessId, code, name, input.component_type, calc, input.sort_order ?? 200],
  );
  if (!row) throw new Error('Failed to create component');
  return row;
}

export async function updateSalaryComponent(
  businessId: string,
  componentId: string,
  patch: Partial<{
    name: string;
    calculation_type: SalaryCalcType;
    is_active: boolean;
    sort_order: number;
  }>,
): Promise<SalaryComponentDefinition> {
  const current = await queryOne<SalaryComponentDefinition>(
    `SELECT * FROM salary_component_definitions WHERE id = $1 AND business_id = $2`,
    [componentId, businessId],
  );
  if (!current) throw new Error('Component not found');

  const name = patch.name !== undefined ? patch.name.trim().slice(0, 120) : current.name;
  const calculation_type = patch.calculation_type ?? current.calculation_type;
  const is_active = patch.is_active !== undefined ? !!patch.is_active : current.is_active;
  const sort_order = patch.sort_order !== undefined ? Number(patch.sort_order) : current.sort_order;

  // System components cannot be deactivated if they are BASIC
  if (current.is_system && current.system_key === 'basic_salary' && !is_active) {
    throw new Error('Basic component cannot be deactivated');
  }

  const row = await queryOne<SalaryComponentDefinition>(
    `UPDATE salary_component_definitions
     SET name = $3, calculation_type = $4, is_active = $5, sort_order = $6, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2
     RETURNING id, business_id, code, name, component_type, calculation_type, system_key,
               is_system, is_active, sort_order`,
    [componentId, businessId, name, calculation_type, is_active, sort_order],
  );
  if (!row) throw new Error('Failed to update component');
  return row;
}

export async function listStructureLines(structureId: string): Promise<
  Array<ResolvedComponentLine & { value: number }>
> {
  const rows = await queryRows<{
    component_id: string;
    code: string;
    name: string;
    component_type: SalaryComponentType;
    calculation_type: SalaryCalcType;
    system_key: string | null;
    value: number;
  }>(
    `SELECT l.component_id, d.code, d.name, d.component_type, d.calculation_type, d.system_key, l.value
     FROM salary_structure_lines l
     JOIN salary_component_definitions d ON d.id = l.component_id
     WHERE l.structure_id = $1
     ORDER BY d.sort_order ASC`,
    [structureId],
  );
  const basic =
    Number(rows.find((r) => r.system_key === 'basic_salary')?.value ?? 0) ||
    Number(rows.find((r) => r.code === 'BASIC')?.value ?? 0);
  const grossPreview = rows
    .filter((r) => r.component_type === 'earning' && r.calculation_type === 'fixed')
    .reduce((s, r) => s + Number(r.value || 0), 0);

  return rows.map((r) => ({
    ...r,
    value: Number(r.value || 0),
    amount: resolveLineAmount(r, basic, grossPreview),
  }));
}

export function resolveLineAmount(
  line: {
    calculation_type: SalaryCalcType;
    value: number;
    component_type: SalaryComponentType;
  },
  basic: number,
  gross: number,
): number {
  const v = Math.max(0, Number(line.value) || 0);
  if (line.calculation_type === 'percent_basic') {
    return Math.round(((basic * v) / 100) * 100) / 100;
  }
  if (line.calculation_type === 'percent_gross') {
    return Math.round(((gross * v) / 100) * 100) / 100;
  }
  return Math.round(v * 100) / 100;
}

/** Map structure lines → legacy salary_structures column payload. */
export function linesToLegacyColumns(lines: StructureLineInput[], catalog: SalaryComponentDefinition[]) {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const cols: Record<string, number | null> = {
    basic_salary: 0,
    hra: 0,
    transport_allowance: 0,
    medical_allowance: 0,
    special_allowance: 0,
    other_allowances: 0,
    pf_percentage: 12,
    pf_fixed_amount: null,
    professional_tax: 0,
    tds_percentage: 0,
    other_deductions: 0,
  };

  let basic = 0;
  for (const line of lines) {
    const def = byId.get(line.component_id);
    if (def?.system_key === 'basic_salary') {
      basic = Number(line.value) || 0;
      break;
    }
  }

  let fixedEarnGross = basic;
  for (const line of lines) {
    const def = byId.get(line.component_id);
    if (!def || !def.is_active) continue;
    if (def.component_type !== 'earning') continue;
    if (def.calculation_type === 'fixed' && def.system_key !== 'basic_salary') {
      fixedEarnGross += Number(line.value) || 0;
    }
  }

  let customEarn = 0;
  let customDed = 0;

  for (const line of lines) {
    const def = byId.get(line.component_id);
    if (!def || !def.is_active) continue;
    const value = Number(line.value) || 0;
    const amount = resolveLineAmount(
      { calculation_type: def.calculation_type, value, component_type: def.component_type },
      basic,
      fixedEarnGross,
    );

    switch (def.system_key) {
      case 'basic_salary':
        cols.basic_salary = value;
        break;
      case 'hra':
        cols.hra = value;
        break;
      case 'transport_allowance':
        cols.transport_allowance = value;
        break;
      case 'medical_allowance':
        cols.medical_allowance = value;
        break;
      case 'special_allowance':
        cols.special_allowance = value;
        break;
      case 'other_allowances':
        cols.other_allowances = value;
        break;
      case 'pf_percentage':
        if (def.calculation_type === 'fixed') {
          cols.pf_fixed_amount = value;
          cols.pf_percentage = 0;
        } else {
          cols.pf_percentage = value;
          cols.pf_fixed_amount = null;
        }
        break;
      case 'professional_tax':
        cols.professional_tax = value;
        break;
      case 'tds_percentage':
        cols.tds_percentage = value;
        break;
      case 'other_deductions':
        cols.other_deductions = value;
        break;
      default:
        // Custom components fold into other_* for payroll column totals
        if (def.component_type === 'earning') customEarn += amount;
        else customDed += amount;
        break;
    }
  }

  cols.other_allowances = Number(cols.other_allowances || 0) + customEarn;
  cols.other_deductions = Number(cols.other_deductions || 0) + customDed;
  return cols;
}

/** Build line values from a legacy salary_structures row (when no lines exist yet). */
export function legacyStructureToLineInputs(
  structure: Record<string, unknown>,
  catalog: SalaryComponentDefinition[],
): StructureLineInput[] {
  const byKey = new Map(
    catalog.filter((c) => c.system_key).map((c) => [c.system_key as string, c]),
  );
  const out: StructureLineInput[] = [];
  const push = (systemKey: string, value: number) => {
    const def = byKey.get(systemKey);
    if (!def) return;
    out.push({ component_id: def.id, value });
  };

  push('basic_salary', Number(structure.basic_salary ?? 0));
  push('hra', Number(structure.hra ?? 0));
  push('transport_allowance', Number(structure.transport_allowance ?? 0));
  push('medical_allowance', Number(structure.medical_allowance ?? 0));
  push('special_allowance', Number(structure.special_allowance ?? 0));
  push('other_allowances', Number(structure.other_allowances ?? 0));

  const pfFixed = structure.pf_fixed_amount != null ? Number(structure.pf_fixed_amount) : null;
  if (pfFixed != null && pfFixed > 0) {
    const pf = byKey.get('pf_percentage');
    if (pf) out.push({ component_id: pf.id, value: pfFixed });
  } else {
    push('pf_percentage', Number(structure.pf_percentage ?? 12));
  }

  push('professional_tax', Number(structure.professional_tax ?? 0));
  push('tds_percentage', Number(structure.tds_percentage ?? 0));
  push('other_deductions', Number(structure.other_deductions ?? 0));
  return out;
}

export async function ensureStructureLinesFromLegacy(
  structureId: string,
  structure: Record<string, unknown>,
  businessId: string,
): Promise<ResolvedComponentLine[]> {
  const existing = await listStructureLines(structureId);
  if (existing.length > 0) return existing;

  const catalog = await listSalaryComponents(businessId, { activeOnly: false });
  const inputs = legacyStructureToLineInputs(structure, catalog);
  if (inputs.length > 0) {
    await replaceStructureLines(structureId, inputs);
  }
  return listStructureLines(structureId);
}

export async function replaceStructureLines(
  structureId: string,
  lines: StructureLineInput[],
): Promise<void> {
  await query(`DELETE FROM salary_structure_lines WHERE structure_id = $1`, [structureId]);
  for (const line of lines) {
    if (!line.component_id) continue;
    await query(
      `INSERT INTO salary_structure_lines (structure_id, component_id, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (structure_id, component_id) DO UPDATE SET value = EXCLUDED.value`,
      [structureId, line.component_id, Number(line.value) || 0],
    );
  }
}

/** Build payment component_breakdown from structure lines + statutory overlay. */
export function buildPaymentComponentBreakdown(args: {
  structureLines: ResolvedComponentLine[];
  statutory?: {
    provident_fund?: number;
    esi_employee?: number;
    professional_tax?: number;
    employer_provident_fund?: number;
    esi_employer?: number;
  };
}): Array<{ code: string; name: string; type: SalaryComponentType; amount: number }> {
  const out: Array<{ code: string; name: string; type: SalaryComponentType; amount: number }> = [];
  for (const line of args.structureLines) {
    if (line.amount <= 0) continue;
    // Skip PF/PT/TDS percent lines — statutory/prefill owns final deduction amounts
    if (line.system_key === 'pf_percentage' || line.system_key === 'tds_percentage') continue;
    out.push({
      code: line.code,
      name: line.name,
      type: line.component_type,
      amount: line.amount,
    });
  }
  if (args.statutory?.provident_fund && args.statutory.provident_fund > 0) {
    out.push({
      code: 'PF',
      name: 'Provident Fund (Employee)',
      type: 'deduction',
      amount: args.statutory.provident_fund,
    });
  }
  if (args.statutory?.esi_employee && args.statutory.esi_employee > 0) {
    out.push({
      code: 'ESI',
      name: 'ESI (Employee)',
      type: 'deduction',
      amount: args.statutory.esi_employee,
    });
  }
  if (args.statutory?.professional_tax && args.statutory.professional_tax > 0) {
    // Replace PT from structure if present
    const idx = out.findIndex((x) => x.code === 'PT');
    if (idx >= 0) out[idx].amount = args.statutory.professional_tax;
    else {
      out.push({
        code: 'PT',
        name: 'Professional Tax',
        type: 'deduction',
        amount: args.statutory.professional_tax,
      });
    }
  }
  return out;
}
