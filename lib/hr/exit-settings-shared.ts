export type ExitApproverRoleType =
  | 'reporting_manager'
  | 'department_head'
  | 'specific_employee'
  | 'hr';

export type ExitApprovalChainLevel = {
  level: number;
  label?: string;
  role_type: ExitApproverRoleType;
  /** Required when role_type is specific_employee */
  employee_id?: string;
};

export type HrExitSettings = {
  default_notice_period_days: number;
  seniority_notice_rules: Array<{ min_years: number; notice_period_days: number }>;
  exit_reasons: string[];
  exit_approval_chain: ExitApprovalChainLevel[];
  exit_min_approval_levels: number;
  exit_max_approval_levels: number | null;
};

export const DEFAULT_EXIT_APPROVAL_CHAIN: ExitApprovalChainLevel[] = [
  { level: 1, label: 'Reporting manager', role_type: 'reporting_manager' },
  { level: 2, label: 'Department head', role_type: 'department_head' },
  { level: 3, label: 'HR', role_type: 'hr' },
];

export const DEFAULT_HR_EXIT_SETTINGS: HrExitSettings = {
  default_notice_period_days: 30,
  seniority_notice_rules: [],
  exit_reasons: [
    'Better opportunity',
    'Personal reasons',
    'Relocation',
    'Performance',
    'Misconduct',
    'Other',
  ],
  exit_approval_chain: DEFAULT_EXIT_APPROVAL_CHAIN,
  exit_min_approval_levels: 1,
  exit_max_approval_levels: null,
};

const ROLE_TYPES: ExitApproverRoleType[] = [
  'reporting_manager',
  'department_head',
  'specific_employee',
  'hr',
];

function normalizeRoleType(value: unknown): ExitApproverRoleType {
  if (typeof value === 'string' && ROLE_TYPES.includes(value as ExitApproverRoleType)) {
    return value as ExitApproverRoleType;
  }
  return 'reporting_manager';
}

function parseApprovalChain(raw: unknown): ExitApprovalChainLevel[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_EXIT_APPROVAL_CHAIN];

  const levels = raw
    .filter((item): item is Record<string, unknown> => item && typeof item === 'object')
    .map((item, index) => ({
      level: Math.max(1, Number(item.level ?? index + 1)),
      label: item.label != null ? String(item.label).trim() : undefined,
      role_type: normalizeRoleType(item.role_type),
      employee_id:
        item.employee_id != null && String(item.employee_id).trim()
          ? String(item.employee_id).trim()
          : undefined,
    }))
    .sort((a, b) => a.level - b.level)
    .map((item, index) => ({ ...item, level: index + 1 }));

  return levels.length ? levels : [...DEFAULT_EXIT_APPROVAL_CHAIN];
}

export function parseHrExitSettings(raw: unknown): HrExitSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_HR_EXIT_SETTINGS };
  const o = raw as Record<string, unknown>;
  const d = DEFAULT_HR_EXIT_SETTINGS;
  const rules = Array.isArray(o.seniority_notice_rules)
    ? o.seniority_notice_rules
        .filter((r): r is Record<string, unknown> => r && typeof r === 'object')
        .map((r) => ({
          min_years: Math.max(0, Number(r.min_years ?? 0)),
          notice_period_days: Math.max(0, Number(r.notice_period_days ?? 30)),
        }))
    : d.seniority_notice_rules;
  const reasons = Array.isArray(o.exit_reasons)
    ? o.exit_reasons.map((x) => String(x).trim()).filter(Boolean)
    : d.exit_reasons;
  const maxLevels = o.exit_max_approval_levels;

  return {
    default_notice_period_days: Math.max(
      0,
      Number(o.default_notice_period_days ?? d.default_notice_period_days),
    ),
    seniority_notice_rules: rules,
    exit_reasons: reasons.length ? reasons : d.exit_reasons,
    exit_approval_chain: parseApprovalChain(o.exit_approval_chain),
    exit_min_approval_levels: Math.max(1, Number(o.exit_min_approval_levels ?? d.exit_min_approval_levels)),
    exit_max_approval_levels:
      maxLevels === null || maxLevels === undefined || maxLevels === ''
        ? null
        : Math.max(1, Number(maxLevels) || 1),
  };
}

export function validateExitApprovalChain(settings: HrExitSettings): string | null {
  const chain = settings.exit_approval_chain;
  if (chain.length < settings.exit_min_approval_levels) {
    return `At least ${settings.exit_min_approval_levels} approval level(s) required`;
  }
  if (
    settings.exit_max_approval_levels != null &&
    chain.length > settings.exit_max_approval_levels
  ) {
    return `At most ${settings.exit_max_approval_levels} approval level(s) allowed`;
  }
  for (const level of chain) {
    if (level.role_type === 'specific_employee' && !level.employee_id) {
      return `Level ${level.level}: select an employee for the specific approver role`;
    }
  }
  const levels = chain.map((l) => l.level).sort((a, b) => a - b);
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] !== i + 1) return 'Approval levels must be sequential starting from 1';
  }
  return null;
}

export function resolveNoticePeriodDays(settings: HrExitSettings, yearsOfService: number): number {
  let days = settings.default_notice_period_days;
  for (const rule of settings.seniority_notice_rules) {
    if (yearsOfService >= rule.min_years) {
      days = rule.notice_period_days;
    }
  }
  return days;
}

export const EXIT_APPROVER_ROLE_LABELS: Record<ExitApproverRoleType, string> = {
  reporting_manager: 'Reporting manager (auto)',
  department_head: 'Department head (auto from org chart)',
  specific_employee: 'Specific employee',
  hr: 'HR (any user with exit permission)',
};
