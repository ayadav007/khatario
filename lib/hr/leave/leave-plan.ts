import { query, queryOne, queryRows } from '@/lib/db';
import {
  DEFAULT_APPLICATION_SETTINGS,
  parseApplicationSettings,
  parseLeaveApprovalChain,
  type LeaveApprovalChainLevel,
  type LeavePlan,
  type LeavePlanApplicationSettings,
  type LeavePlanRestriction,
  type LeavePlanTypeRule,
  type LeaveAccrualMode,
  type LeaveRoundingMode,
  type LeaveYearEndTreatment,
  type LeaveNegativeBalanceTreatment,
  type LeaveEncashmentRateBasis,
} from '@/lib/hr/leave/types';

function parsePlanTypeRow(row: Record<string, unknown>): LeavePlanTypeRule {
  return {
    id: String(row.id),
    leave_plan_id: String(row.leave_plan_id),
    leave_type_id: String(row.leave_type_id),
    leave_name: row.leave_name != null ? String(row.leave_name) : undefined,
    leave_code: row.leave_code != null ? String(row.leave_code) : undefined,
    annual_quota: Number(row.annual_quota ?? 0),
    accrual_mode: (row.accrual_mode as LeaveAccrualMode) ?? 'lump_sum',
    accrual_day_of_month: Number(row.accrual_day_of_month ?? 1),
    prorate_on_join: row.prorate_on_join !== false,
    rounding_mode: (row.rounding_mode as LeaveRoundingMode) ?? 'none',
    employee_can_apply: row.employee_can_apply !== false,
    min_notice_days: Number(row.min_notice_days ?? 0),
    allow_backdated: row.allow_backdated === true,
    max_future_days: row.max_future_days != null ? Number(row.max_future_days) : null,
    blocked_in_probation: row.blocked_in_probation === true,
    blocked_in_notice_period: row.blocked_in_notice_period !== false,
    requires_comment: row.requires_comment === true,
    requires_attachment: row.requires_attachment === true,
    attachment_min_days:
      row.attachment_min_days != null ? Number(row.attachment_min_days) : null,
    sandwich_enabled: row.sandwich_enabled === true,
    sandwich_count_weekends: row.sandwich_count_weekends !== false,
    sandwich_count_holidays: row.sandwich_count_holidays !== false,
    year_end_treatment: (row.year_end_treatment as LeaveYearEndTreatment) ?? 'carry_forward',
    max_carry_forward_days:
      row.max_carry_forward_days != null ? Number(row.max_carry_forward_days) : null,
    carry_forward_expiry_months:
      row.carry_forward_expiry_months != null ? Number(row.carry_forward_expiry_months) : null,
    allow_negative_balance: row.allow_negative_balance === true,
    negative_balance_treatment:
      (row.negative_balance_treatment as LeaveNegativeBalanceTreatment) ?? 'reset',
    requires_approval: row.requires_approval !== false,
    sort_order: Number(row.sort_order ?? 0),
  };
}

export async function ensureDefaultLeavePlan(businessId: string): Promise<LeavePlan> {
  const existing = await getDefaultLeavePlan(businessId);
  if (existing) return existing;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO leave_plans (business_id, name, is_default, application_settings)
     VALUES ($1, 'Default leave plan', true, $2::jsonb)
     RETURNING id`,
    [businessId, JSON.stringify(DEFAULT_APPLICATION_SETTINGS)],
  );
  if (!row) throw new Error('Failed to create default leave plan');

  const types = await queryRows<{ id: string; max_days_per_year: number | null; carry_forward: boolean; max_carry_forward_days: number | null; requires_approval: boolean }>(
    `SELECT id, max_days_per_year, carry_forward, max_carry_forward_days, requires_approval
     FROM leave_types WHERE business_id = $1 AND is_active = true ORDER BY leave_code`,
    [businessId],
  );

  let sort = 0;
  for (const t of types) {
    await query(
      `INSERT INTO leave_plan_types (
         leave_plan_id, leave_type_id, annual_quota, year_end_treatment,
         max_carry_forward_days, requires_approval, sort_order
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (leave_plan_id, leave_type_id) DO NOTHING`,
      [
        row.id,
        t.id,
        Number(t.max_days_per_year ?? 0),
        t.carry_forward ? 'carry_forward' : 'expire',
        t.max_carry_forward_days,
        t.requires_approval !== false,
        sort++,
      ],
    );
  }

  return (await getDefaultLeavePlan(businessId))!;
}

export async function getDefaultLeavePlan(businessId: string): Promise<LeavePlan | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM leave_plans WHERE business_id = $1 AND is_default = true LIMIT 1`,
    [businessId],
  );
  if (!row) return null;
  return {
    id: String(row.id),
    business_id: String(row.business_id),
    name: String(row.name),
    calendar_year_start_month: Number(row.calendar_year_start_month ?? 1),
    policy_document_url: row.policy_document_url ? String(row.policy_document_url) : null,
    application_settings: parseApplicationSettings(row.application_settings),
    leave_approval_chain: parseLeaveApprovalChain(row.leave_approval_chain),
    encashment_daily_rate_basis:
      (row.encashment_daily_rate_basis as LeaveEncashmentRateBasis) ?? 'basic_per_30',
    is_default: row.is_default === true,
    is_active: row.is_active !== false,
  };
}

export async function getLeavePlanTypeRules(
  leavePlanId: string,
): Promise<LeavePlanTypeRule[]> {
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT lpt.*, lt.leave_name, lt.leave_code
     FROM leave_plan_types lpt
     INNER JOIN leave_types lt ON lt.id = lpt.leave_type_id
     WHERE lpt.leave_plan_id = $1
     ORDER BY lpt.sort_order, lt.leave_code`,
    [leavePlanId],
  );
  return rows.map(parsePlanTypeRow);
}

export async function getLeavePlanTypeRule(
  leavePlanId: string,
  leaveTypeId: string,
): Promise<LeavePlanTypeRule | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT lpt.*, lt.leave_name, lt.leave_code
     FROM leave_plan_types lpt
     INNER JOIN leave_types lt ON lt.id = lpt.leave_type_id
     WHERE lpt.leave_plan_id = $1 AND lpt.leave_type_id = $2`,
    [leavePlanId, leaveTypeId],
  );
  return row ? parsePlanTypeRow(row) : null;
}

export async function getLeavePlanRestrictions(
  leavePlanId: string,
): Promise<LeavePlanRestriction[]> {
  return queryRows(
    `SELECT id, leave_plan_id, restriction_type, leave_type_id_a, leave_type_id_b, config
     FROM leave_plan_restrictions WHERE leave_plan_id = $1`,
    [leavePlanId],
  );
}

export async function getDefaultPlanBundle(businessId: string) {
  const plan = (await getDefaultLeavePlan(businessId)) ?? (await ensureDefaultLeavePlan(businessId));
  const typeRules = await getLeavePlanTypeRules(plan.id);
  const restrictions = await getLeavePlanRestrictions(plan.id);
  return { plan, typeRules, restrictions };
}

export async function saveDefaultLeavePlan(
  businessId: string,
  input: {
    name?: string;
    calendar_year_start_month?: number;
    policy_document_url?: string | null;
    application_settings?: LeavePlanApplicationSettings;
    leave_approval_chain?: LeaveApprovalChainLevel[];
    encashment_daily_rate_basis?: LeaveEncashmentRateBasis;
    type_rules?: LeavePlanTypeRule[];
    restrictions?: LeavePlanRestriction[];
  },
): Promise<{ plan: LeavePlan; typeRules: LeavePlanTypeRule[]; restrictions: LeavePlanRestriction[] }> {
  const plan = (await getDefaultLeavePlan(businessId)) ?? (await ensureDefaultLeavePlan(businessId));

  await queryOne(
    `UPDATE leave_plans SET
       name = COALESCE($2, name),
       calendar_year_start_month = COALESCE($3, calendar_year_start_month),
       policy_document_url = COALESCE($4, policy_document_url),
       application_settings = COALESCE($5::jsonb, application_settings),
       leave_approval_chain = COALESCE($6::jsonb, leave_approval_chain),
       encashment_daily_rate_basis = COALESCE($7, encashment_daily_rate_basis),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      plan.id,
      input.name ?? null,
      input.calendar_year_start_month ?? null,
      input.policy_document_url !== undefined ? input.policy_document_url : null,
      input.application_settings ? JSON.stringify(input.application_settings) : null,
      input.leave_approval_chain ? JSON.stringify(input.leave_approval_chain) : null,
      input.encashment_daily_rate_basis ?? null,
    ],
  );

  if (input.type_rules) {
    for (const rule of input.type_rules) {
      await queryOne(
        `INSERT INTO leave_plan_types (
           leave_plan_id, leave_type_id, annual_quota, accrual_mode, accrual_day_of_month,
           prorate_on_join, rounding_mode, employee_can_apply, min_notice_days,
           allow_backdated, max_future_days, blocked_in_probation, blocked_in_notice_period,
           requires_comment, requires_attachment, attachment_min_days,
           sandwich_enabled, sandwich_count_weekends, sandwich_count_holidays,
           year_end_treatment, max_carry_forward_days, carry_forward_expiry_months,
           allow_negative_balance, negative_balance_treatment, requires_approval, sort_order
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
         )
         ON CONFLICT (leave_plan_id, leave_type_id) DO UPDATE SET
           annual_quota = EXCLUDED.annual_quota,
           accrual_mode = EXCLUDED.accrual_mode,
           accrual_day_of_month = EXCLUDED.accrual_day_of_month,
           prorate_on_join = EXCLUDED.prorate_on_join,
           rounding_mode = EXCLUDED.rounding_mode,
           employee_can_apply = EXCLUDED.employee_can_apply,
           min_notice_days = EXCLUDED.min_notice_days,
           allow_backdated = EXCLUDED.allow_backdated,
           max_future_days = EXCLUDED.max_future_days,
           blocked_in_probation = EXCLUDED.blocked_in_probation,
           blocked_in_notice_period = EXCLUDED.blocked_in_notice_period,
           requires_comment = EXCLUDED.requires_comment,
           requires_attachment = EXCLUDED.requires_attachment,
           attachment_min_days = EXCLUDED.attachment_min_days,
           sandwich_enabled = EXCLUDED.sandwich_enabled,
           sandwich_count_weekends = EXCLUDED.sandwich_count_weekends,
           sandwich_count_holidays = EXCLUDED.sandwich_count_holidays,
           year_end_treatment = EXCLUDED.year_end_treatment,
           max_carry_forward_days = EXCLUDED.max_carry_forward_days,
           carry_forward_expiry_months = EXCLUDED.carry_forward_expiry_months,
           allow_negative_balance = EXCLUDED.allow_negative_balance,
           negative_balance_treatment = EXCLUDED.negative_balance_treatment,
           requires_approval = EXCLUDED.requires_approval,
           sort_order = EXCLUDED.sort_order,
           updated_at = CURRENT_TIMESTAMP`,
        [
          plan.id,
          rule.leave_type_id,
          rule.annual_quota,
          rule.accrual_mode,
          rule.accrual_day_of_month,
          rule.prorate_on_join,
          rule.rounding_mode,
          rule.employee_can_apply,
          rule.min_notice_days,
          rule.allow_backdated,
          rule.max_future_days,
          rule.blocked_in_probation,
          rule.blocked_in_notice_period,
          rule.requires_comment,
          rule.requires_attachment,
          rule.attachment_min_days,
          rule.sandwich_enabled,
          rule.sandwich_count_weekends,
          rule.sandwich_count_holidays,
          rule.year_end_treatment,
          rule.max_carry_forward_days,
          rule.carry_forward_expiry_months,
          rule.allow_negative_balance,
          rule.negative_balance_treatment,
          rule.requires_approval,
          rule.sort_order,
        ],
      );
    }
  }

  if (input.restrictions) {
    await query(`DELETE FROM leave_plan_restrictions WHERE leave_plan_id = $1`, [plan.id]);
    for (const r of input.restrictions) {
      await query(
        `INSERT INTO leave_plan_restrictions (
           leave_plan_id, restriction_type, leave_type_id_a, leave_type_id_b, config
         ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          plan.id,
          r.restriction_type,
          r.leave_type_id_a,
          r.leave_type_id_b ?? null,
          JSON.stringify(r.config ?? {}),
        ],
      );
    }
  }

  return getDefaultPlanBundle(businessId);
}

export async function syncPlanTypesFromLeaveTypes(businessId: string): Promise<void> {
  const plan = await ensureDefaultLeavePlan(businessId);
  const types = await queryRows<{ id: string; max_days_per_year: number | null; carry_forward: boolean; max_carry_forward_days: number | null; requires_approval: boolean }>(
    `SELECT id, max_days_per_year, carry_forward, max_carry_forward_days, requires_approval
     FROM leave_types WHERE business_id = $1 AND is_active = true`,
    [businessId],
  );
  const existing = new Set(
    (await getLeavePlanTypeRules(plan.id)).map((r) => r.leave_type_id),
  );
  let sort = existing.size;
  for (const t of types) {
    if (existing.has(t.id)) continue;
    await query(
      `INSERT INTO leave_plan_types (
         leave_plan_id, leave_type_id, annual_quota, year_end_treatment,
         max_carry_forward_days, requires_approval, sort_order
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        plan.id,
        t.id,
        Number(t.max_days_per_year ?? 0),
        t.carry_forward ? 'carry_forward' : 'expire',
        t.max_carry_forward_days,
        t.requires_approval !== false,
        sort++,
      ],
    );
  }
}
