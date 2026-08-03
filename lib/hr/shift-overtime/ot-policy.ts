import { query, queryOne, queryRows } from '@/lib/db';
import {
  parseOtApprovalChain,
  type OtApprovalChainLevel,
  type OtPolicy,
  type OtPolicyRule,
} from '@/lib/hr/shift-overtime/types';

function parseRule(row: Record<string, unknown>): OtPolicyRule {
  return {
    id: String(row.id),
    ot_policy_id: String(row.ot_policy_id),
    scenario: row.scenario as OtPolicyRule['scenario'],
    pay_mode: (row.pay_mode as OtPolicyRule['pay_mode']) ?? 'multiplier',
    multiplier: Number(row.multiplier ?? 1.5),
    fixed_amount: row.fixed_amount != null ? Number(row.fixed_amount) : null,
    compensation_type: (row.compensation_type as OtPolicyRule['compensation_type']) ?? 'monetary',
    comp_off_days: Number(row.comp_off_days ?? 1),
    exclude_break: row.exclude_break !== false,
    min_minutes: Number(row.min_minutes ?? 0),
  };
}

export async function ensureOtPolicy(businessId: string): Promise<OtPolicy> {
  const existing = await getOtPolicy(businessId);
  if (existing) return existing;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO ot_policies (business_id) VALUES ($1) RETURNING id`,
    [businessId],
  );
  const scenarios = [
    { scenario: 'working_day', mult: 1.5 },
    { scenario: 'weekly_off', mult: 2.0 },
    { scenario: 'holiday', mult: 2.0 },
  ];
  for (const s of scenarios) {
    await query(
      `INSERT INTO ot_policy_rules (ot_policy_id, scenario, pay_mode, multiplier, compensation_type, min_minutes)
       VALUES ($1, $2, 'multiplier', $3, 'employee_choice', 30) ON CONFLICT DO NOTHING`,
      [row!.id, s.scenario, s.mult],
    );
  }
  return (await getOtPolicy(businessId))!;
}

export async function getOtPolicy(businessId: string): Promise<OtPolicy | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM ot_policies WHERE business_id = $1 LIMIT 1`,
    [businessId],
  );
  if (!row) return null;
  return {
    id: String(row.id),
    business_id: String(row.business_id),
    name: String(row.name),
    prior_notice_days: Number(row.prior_notice_days ?? 0),
    allow_backdated: row.allow_backdated === true,
    max_backdate_days: row.max_backdate_days != null ? Number(row.max_backdate_days) : null,
    require_justification: row.require_justification === true,
    comp_off_leave_type_id: row.comp_off_leave_type_id ? String(row.comp_off_leave_type_id) : null,
    approval_chain: parseOtApprovalChain(row.approval_chain),
    is_active: row.is_active !== false,
  };
}

export async function getOtPolicyRules(otPolicyId: string): Promise<OtPolicyRule[]> {
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT * FROM ot_policy_rules WHERE ot_policy_id = $1 ORDER BY scenario`,
    [otPolicyId],
  );
  return rows.map(parseRule);
}

export async function getOtPolicyBundle(businessId: string) {
  const policy = (await getOtPolicy(businessId)) ?? (await ensureOtPolicy(businessId));
  const rules = await getOtPolicyRules(policy.id);
  return { policy, rules };
}

export async function saveOtPolicy(
  businessId: string,
  input: {
    name?: string;
    prior_notice_days?: number;
    allow_backdated?: boolean;
    max_backdate_days?: number | null;
    require_justification?: boolean;
    comp_off_leave_type_id?: string | null;
    approval_chain?: OtApprovalChainLevel[];
    rules?: OtPolicyRule[];
  },
) {
  const policy = (await getOtPolicy(businessId)) ?? (await ensureOtPolicy(businessId));

  await queryOne(
    `UPDATE ot_policies SET
       name = COALESCE($2, name),
       prior_notice_days = COALESCE($3, prior_notice_days),
       allow_backdated = COALESCE($4, allow_backdated),
       max_backdate_days = COALESCE($5, max_backdate_days),
       require_justification = COALESCE($6, require_justification),
       comp_off_leave_type_id = COALESCE($7, comp_off_leave_type_id),
       approval_chain = COALESCE($8::jsonb, approval_chain),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      policy.id,
      input.name ?? null,
      input.prior_notice_days ?? null,
      input.allow_backdated ?? null,
      input.max_backdate_days !== undefined ? input.max_backdate_days : null,
      input.require_justification ?? null,
      input.comp_off_leave_type_id !== undefined ? input.comp_off_leave_type_id : null,
      input.approval_chain ? JSON.stringify(input.approval_chain) : null,
    ],
  );

  if (input.rules) {
    for (const rule of input.rules) {
      await queryOne(
        `INSERT INTO ot_policy_rules (
           ot_policy_id, scenario, pay_mode, multiplier, fixed_amount,
           compensation_type, comp_off_days, exclude_break, min_minutes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (ot_policy_id, scenario) DO UPDATE SET
           pay_mode = EXCLUDED.pay_mode,
           multiplier = EXCLUDED.multiplier,
           fixed_amount = EXCLUDED.fixed_amount,
           compensation_type = EXCLUDED.compensation_type,
           comp_off_days = EXCLUDED.comp_off_days,
           exclude_break = EXCLUDED.exclude_break,
           min_minutes = EXCLUDED.min_minutes`,
        [
          policy.id,
          rule.scenario,
          rule.pay_mode,
          rule.multiplier,
          rule.fixed_amount,
          rule.compensation_type,
          rule.comp_off_days,
          rule.exclude_break,
          rule.min_minutes,
        ],
      );
    }
  }

  return getOtPolicyBundle(businessId);
}

export type OtApplicationInput = {
  businessId: string;
  employeeId: string;
  requestDate: string;
  durationMinutes: number;
  reason?: string | null;
  compensationChoice?: 'monetary' | 'comp_off' | null;
  actorUserId: string;
  isPortalSelfApply: boolean;
};

export async function validateOtApplication(input: OtApplicationInput): Promise<void> {
  const { policy, rules } = await getOtPolicyBundle(input.businessId);
  const scenario = await detectOtScenario(input.businessId, input.employeeId, input.requestDate);
  const rule = rules.find((r) => r.scenario === scenario);
  if (!rule) throw new Error('No OT rule configured for this day type');

  if (input.durationMinutes < rule.min_minutes) {
    throw new Error(`Minimum ${rule.min_minutes} minutes required for overtime`);
  }

  if (policy.require_justification && !input.reason?.trim()) {
    throw new Error('Justification is required for overtime');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const reqDate = new Date(input.requestDate);

  if (!policy.allow_backdated && reqDate < today) {
    throw new Error('Backdated overtime requests are not allowed');
  }

  if (policy.allow_backdated && policy.max_backdate_days != null && reqDate < today) {
    const minDate = new Date(today);
    minDate.setDate(minDate.getDate() - policy.max_backdate_days);
    if (reqDate < minDate) {
      throw new Error(`Cannot apply overtime more than ${policy.max_backdate_days} days back`);
    }
  }

  if (policy.prior_notice_days > 0 && reqDate >= today) {
    const deadline = new Date(today);
    deadline.setDate(deadline.getDate() + policy.prior_notice_days);
    if (reqDate < deadline) {
      throw new Error(`At least ${policy.prior_notice_days} day(s) prior notice is required`);
    }
  }

  const effectiveComp =
    rule.compensation_type === 'employee_choice'
      ? input.compensationChoice
      : rule.compensation_type === 'comp_off'
        ? 'comp_off'
        : 'monetary';

  if (rule.compensation_type === 'employee_choice' && !effectiveComp) {
    throw new Error('Please choose monetary payment or comp-off');
  }

  if (effectiveComp === 'comp_off' && !policy.comp_off_leave_type_id) {
    throw new Error('Comp-off leave type is not configured in OT policy');
  }
}

export async function detectOtScenario(
  businessId: string,
  employeeId: string,
  dateStr: string,
): Promise<'working_day' | 'weekly_off' | 'holiday'> {
  const { isHolidayForEmployee } = await import('@/lib/hr/shift-overtime/holiday-lists');
  const { getEmployeeWeeklyOffPolicy, isWeeklyOffDate } = await import(
    '@/lib/hr/shift-overtime/weekly-off'
  );

  if (await isHolidayForEmployee(businessId, employeeId, dateStr)) return 'holiday';
  const policy = await getEmployeeWeeklyOffPolicy(businessId, employeeId);
  if (isWeeklyOffDate(dateStr, policy)) return 'weekly_off';
  return 'working_day';
}

export async function resolveEffectiveCompensation(
  businessId: string,
  employeeId: string,
  requestDate: string,
  choice: 'monetary' | 'comp_off' | null | undefined,
): Promise<'monetary' | 'comp_off'> {
  const { rules } = await getOtPolicyBundle(businessId);
  const scenario = await detectOtScenario(businessId, employeeId, requestDate);
  const rule = rules.find((r) => r.scenario === scenario)!;
  if (rule.compensation_type === 'comp_off') return 'comp_off';
  if (rule.compensation_type === 'monetary') return 'monetary';
  return choice ?? 'monetary';
}
