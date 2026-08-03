import { ESS_FEATURE_GATES } from '@/lib/employee-portal/feature-gates';

describe('ESS feature gates', () => {
  it('maps portal module to hr_employee_portal', () => {
    expect(ESS_FEATURE_GATES.portal).toBe('hr_employee_portal');
  });

  it('maps attendance to hr_attendance', () => {
    expect(ESS_FEATURE_GATES.attendance).toBe('hr_attendance');
  });

  it('maps payslips to hr_payroll', () => {
    expect(ESS_FEATURE_GATES.payslips).toBe('hr_payroll');
  });

  it('maps expenses to hr_employees (not billing purchase_expenses)', () => {
    expect(ESS_FEATURE_GATES.expenses).toBe('hr_employees');
  });
});
