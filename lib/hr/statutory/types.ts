/** Business-level statutory payroll config (stored in hr_payroll_settings JSONB). */

export type PtStateCode = 'MH' | 'KA' | 'WB' | 'TN' | 'GJ' | 'DL' | 'OTHER';

export type StatutoryPayrollSettings = {
  monthly_pay_day: number | null;

  pf_enabled: boolean;
  pf_establishment_id: string;
  /** Employee PF % (default 12). */
  pf_employee_rate: number;
  /** Employer PF % (default 12 — EPF+EPS+EDLI simplified as single employer %). */
  pf_employer_rate: number;
  /** Wage ceiling for PF (₹15,000 statutory default). */
  pf_wage_ceiling: number;

  esi_enabled: boolean;
  esi_code: string;
  /** Employee ESI % (default 0.75). */
  esi_employee_rate: number;
  /** Employer ESI % (default 3.25). */
  esi_employer_rate: number;
  /** Gross wage ceiling for ESI eligibility (₹21,000). */
  esi_wage_ceiling: number;

  pt_enabled: boolean;
  pt_state: PtStateCode | null;
  pt_registration_no: string;
};

export type StatutoryCalcInput = {
  settings: StatutoryPayrollSettings;
  basic: number;
  gross: number;
  /** Structure override: fixed PF amount (takes precedence over %). */
  pfFixedAmount?: number | null;
  /** Structure override: fixed PT amount (takes precedence over state slab). */
  professionalTaxFixed?: number | null;
  pfApplicable?: boolean;
  esiApplicable?: boolean;
};

export type StatutoryCalcResult = {
  pf_wage: number;
  provident_fund: number;
  employer_provident_fund: number;
  esi_wage: number;
  esi_employee: number;
  esi_employer: number;
  professional_tax: number;
  breakdown: {
    pf_enabled: boolean;
    pf_employee_rate: number;
    pf_employer_rate: number;
    pf_wage_ceiling: number;
    pf_source: 'fixed' | 'percent' | 'disabled' | 'not_applicable';
    esi_enabled: boolean;
    esi_employee_rate: number;
    esi_employer_rate: number;
    esi_wage_ceiling: number;
    esi_source: 'percent' | 'above_ceiling' | 'disabled' | 'not_applicable';
    pt_enabled: boolean;
    pt_state: PtStateCode | null;
    pt_source: 'fixed' | 'slab' | 'disabled';
  };
};
