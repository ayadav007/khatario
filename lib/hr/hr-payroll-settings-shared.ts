/**
 * Client-safe payroll settings types/defaults/parsers (no DB / pg).
 * Server loaders live in hr-payroll-settings.ts.
 */

import type { PtStateCode, StatutoryPayrollSettings } from '@/lib/hr/statutory/types';

export type HrPayrollSettings = StatutoryPayrollSettings;

const PT_STATES: PtStateCode[] = ['MH', 'KA', 'WB', 'TN', 'GJ', 'DL', 'OTHER'];

export const DEFAULT_HR_PAYROLL_SETTINGS: HrPayrollSettings = {
  monthly_pay_day: null,
  pf_enabled: true,
  pf_establishment_id: '',
  pf_employee_rate: 12,
  pf_employer_rate: 12,
  pf_wage_ceiling: 15000,
  esi_enabled: false,
  esi_code: '',
  esi_employee_rate: 0.75,
  esi_employer_rate: 3.25,
  esi_wage_ceiling: 21000,
  pt_enabled: false,
  pt_state: null,
  pt_registration_no: '',
};

function num(v: unknown, fallback: number, min = 0, max = 100): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function parseHrPayrollSettings(raw: unknown): HrPayrollSettings {
  const base = { ...DEFAULT_HR_PAYROLL_SETTINGS };
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;

  const day = o.monthly_pay_day;
  let monthly_pay_day: number | null = null;
  if (day !== null && day !== undefined && day !== '') {
    const n = Number(day);
    if (Number.isFinite(n) && n >= 1 && n <= 28) monthly_pay_day = Math.floor(n);
  }

  const ptStateRaw = str(o.pt_state).toUpperCase();
  const pt_state =
    ptStateRaw && PT_STATES.includes(ptStateRaw as PtStateCode)
      ? (ptStateRaw as PtStateCode)
      : null;

  return {
    monthly_pay_day,
    pf_enabled: o.pf_enabled === undefined ? base.pf_enabled : !!o.pf_enabled,
    pf_establishment_id: str(o.pf_establishment_id),
    pf_employee_rate: num(o.pf_employee_rate, base.pf_employee_rate, 0, 100),
    pf_employer_rate: num(o.pf_employer_rate, base.pf_employer_rate, 0, 100),
    pf_wage_ceiling: num(o.pf_wage_ceiling, base.pf_wage_ceiling, 0, 1_000_000),
    esi_enabled: o.esi_enabled === undefined ? base.esi_enabled : !!o.esi_enabled,
    esi_code: str(o.esi_code),
    esi_employee_rate: num(o.esi_employee_rate, base.esi_employee_rate, 0, 100),
    esi_employer_rate: num(o.esi_employer_rate, base.esi_employer_rate, 0, 100),
    esi_wage_ceiling: num(o.esi_wage_ceiling, base.esi_wage_ceiling, 0, 1_000_000),
    pt_enabled: o.pt_enabled === undefined ? base.pt_enabled : !!o.pt_enabled,
    pt_state,
    pt_registration_no: str(o.pt_registration_no),
  };
}
