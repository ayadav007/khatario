export type LeaveAccrualMode = 'lump_sum' | 'monthly' | 'quarterly';
export type LeaveRoundingMode = 'none' | 'half_day' | 'full_day';
export type LeaveYearEndTreatment = 'expire' | 'carry_forward' | 'encash' | 'carry_or_encash';
export type LeaveNegativeBalanceTreatment = 'reset' | 'carry_deficit';
export type LeaveEncashmentRateBasis = 'basic_per_30' | 'gross_per_30';
export type LeaveRestrictionType = 'no_consecutive' | 'block_combination';
export type LeaveApprovalRoleType = 'reporting_manager' | 'department_head' | 'specific_employee' | 'hr';

export type LeavePlanApplicationSettings = {
  manager_can_apply_on_behalf: boolean;
  hr_can_apply_on_behalf: boolean;
};

export type LeaveApprovalChainLevel = {
  level: number;
  label?: string;
  role_type: LeaveApprovalRoleType;
  employee_id?: string;
};

export type LeavePlan = {
  id: string;
  business_id: string;
  name: string;
  calendar_year_start_month: number;
  policy_document_url: string | null;
  application_settings: LeavePlanApplicationSettings;
  leave_approval_chain: LeaveApprovalChainLevel[];
  encashment_daily_rate_basis: LeaveEncashmentRateBasis;
  is_default: boolean;
  is_active: boolean;
};

export type LeavePlanTypeRule = {
  id?: string;
  leave_plan_id?: string;
  leave_type_id: string;
  leave_name?: string;
  leave_code?: string;
  annual_quota: number;
  accrual_mode: LeaveAccrualMode;
  accrual_day_of_month: number;
  prorate_on_join: boolean;
  rounding_mode: LeaveRoundingMode;
  employee_can_apply: boolean;
  min_notice_days: number;
  allow_backdated: boolean;
  max_future_days: number | null;
  blocked_in_probation: boolean;
  blocked_in_notice_period: boolean;
  requires_comment: boolean;
  requires_attachment: boolean;
  attachment_min_days: number | null;
  sandwich_enabled: boolean;
  sandwich_count_weekends: boolean;
  sandwich_count_holidays: boolean;
  year_end_treatment: LeaveYearEndTreatment;
  max_carry_forward_days: number | null;
  carry_forward_expiry_months: number | null;
  allow_negative_balance: boolean;
  negative_balance_treatment: LeaveNegativeBalanceTreatment;
  requires_approval: boolean;
  sort_order: number;
};

export type LeavePlanRestriction = {
  id?: string;
  leave_plan_id?: string;
  restriction_type: LeaveRestrictionType;
  leave_type_id_a: string;
  leave_type_id_b?: string | null;
  config?: Record<string, unknown>;
};

export const DEFAULT_APPLICATION_SETTINGS: LeavePlanApplicationSettings = {
  manager_can_apply_on_behalf: true,
  hr_can_apply_on_behalf: true,
};

export function getLeaveYear(date: Date | string, calendarYearStartMonth = 1): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  return month >= calendarYearStartMonth ? year : year - 1;
}

export function getLeaveYearDateRange(
  leaveYear: number,
  calendarYearStartMonth: number,
): { start: string; end: string } {
  const startMonth = calendarYearStartMonth;
  const startYear = leaveYear;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endYear = startMonth === 1 ? leaveYear : leaveYear + 1;
  const endDay = new Date(endYear, endMonth, 0).getDate();
  return {
    start: `${startYear}-${String(startMonth).padStart(2, '0')}-01`,
    end: `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
  };
}

export function roundLeaveDays(value: number, mode: LeaveRoundingMode): number {
  if (mode === 'half_day') return Math.round(value * 2) / 2;
  if (mode === 'full_day') return Math.round(value);
  return Math.round(value * 100) / 100;
}

export function parseApplicationSettings(raw: unknown): LeavePlanApplicationSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_APPLICATION_SETTINGS };
  const o = raw as Record<string, unknown>;
  return {
    manager_can_apply_on_behalf: o.manager_can_apply_on_behalf !== false,
    hr_can_apply_on_behalf: o.hr_can_apply_on_behalf !== false,
  };
}

export function parseLeaveApprovalChain(raw: unknown): LeaveApprovalChainLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => item && typeof item === 'object')
    .map((item, index) => ({
      level: Math.max(1, Number(item.level ?? index + 1)),
      label: item.label != null ? String(item.label) : undefined,
      role_type: (['reporting_manager', 'department_head', 'specific_employee', 'hr'].includes(
        String(item.role_type),
      )
        ? String(item.role_type)
        : 'reporting_manager') as LeaveApprovalRoleType,
      employee_id: item.employee_id ? String(item.employee_id) : undefined,
    }))
    .sort((a, b) => a.level - b.level)
    .map((item, index) => ({ ...item, level: index + 1 }));
}
