export type WeeklyOffNthRule = {
  week: number; // 1-5, or -1 for last occurrence in month
  weekday: number; // 0=Sun .. 6=Sat
};

export type WeeklyOffPolicy = {
  fixed_days: number[];
  nth_rules: WeeklyOffNthRule[];
};

export type OtScenario = 'working_day' | 'weekly_off' | 'holiday';
export type OtPayMode = 'multiplier' | 'fixed_lump';
export type OtCompensationType = 'monetary' | 'comp_off' | 'employee_choice';
export type OtCompensationChoice = 'monetary' | 'comp_off';

export type OtApprovalRoleType =
  | 'reporting_manager'
  | 'department_head'
  | 'specific_employee'
  | 'hr';

export type OtApprovalChainLevel = {
  level: number;
  label?: string;
  role_type: OtApprovalRoleType;
  employee_id?: string;
};

export type OtPolicyRule = {
  id?: string;
  ot_policy_id?: string;
  scenario: OtScenario;
  pay_mode: OtPayMode;
  multiplier: number;
  fixed_amount: number | null;
  compensation_type: OtCompensationType;
  comp_off_days: number;
  exclude_break: boolean;
  min_minutes: number;
};

export type OtPolicy = {
  id: string;
  business_id: string;
  name: string;
  prior_notice_days: number;
  allow_backdated: boolean;
  max_backdate_days: number | null;
  require_justification: boolean;
  comp_off_leave_type_id: string | null;
  approval_chain: OtApprovalChainLevel[];
  is_active: boolean;
};

export type HolidayList = {
  id: string;
  business_id: string;
  branch_id: string | null;
  name: string;
  is_default: boolean;
};

export const DEFAULT_WEEKLY_OFF_POLICY: WeeklyOffPolicy = {
  fixed_days: [0],
  nth_rules: [],
};

export function parseWeeklyOffPolicy(raw: unknown): WeeklyOffPolicy {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WEEKLY_OFF_POLICY };
  const o = raw as Record<string, unknown>;
  const fixed = Array.isArray(o.fixed_days)
    ? o.fixed_days.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6)
    : [0];
  const nth = Array.isArray(o.nth_rules)
    ? o.nth_rules
        .filter((r): r is Record<string, unknown> => r && typeof r === 'object')
        .map((r) => ({
          week: Number(r.week),
          weekday: Number(r.weekday),
        }))
        .filter((r) => r.weekday >= 0 && r.weekday <= 6)
    : [];
  return { fixed_days: fixed.length ? fixed : [0], nth_rules: nth };
}

export function parseOtApprovalChain(raw: unknown): OtApprovalChainLevel[] {
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
        : 'reporting_manager') as OtApprovalRoleType,
      employee_id: item.employee_id ? String(item.employee_id) : undefined,
    }))
    .sort((a, b) => a.level - b.level)
    .map((item, index) => ({ ...item, level: index + 1 }));
}
