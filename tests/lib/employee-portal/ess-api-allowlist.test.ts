import { isEssApiAllowed } from '@/lib/employee-portal/ess-api-allowlist';
import { isPublicBusinessEmployeePath, isReservedBusinessSlug } from '@/lib/employee-portal/reserved-slugs';
describe('employee portal allowlist', () => {
  it('allows attendance check-in POST', () => {
    expect(isEssApiAllowed('POST', '/api/employees/attendance/check-in')).toBe(true);
  });

  it('allows payslip list GET', () => {
    expect(isEssApiAllowed('GET', '/api/employees/salary/payslips')).toBe(true);
  });

  it('blocks invoices API', () => {
    expect(isEssApiAllowed('GET', '/api/invoices')).toBe(false);
  });

  it('allows manager exit approval PATCH', () => {
    expect(isEssApiAllowed('PATCH', '/api/employees/manager/exit-approvals/abc-123')).toBe(true);
  });

  it('allows portal resignation DELETE', () => {
    expect(isEssApiAllowed('DELETE', '/api/public/employee/portal/resignation')).toBe(true);
  });
});

describe('reserved slugs', () => {
  it('reserves login and dashboard', () => {
    expect(isReservedBusinessSlug('login')).toBe(true);
    expect(isReservedBusinessSlug('dashboard')).toBe(true);
  });

  it('allows business-like slugs', () => {
    expect(isReservedBusinessSlug('acme-traders')).toBe(false);
  });
});

describe('public business employee paths', () => {
  it('matches employee portal routes', () => {
    expect(isPublicBusinessEmployeePath('/acme/employees')).toBe(true);
    expect(isPublicBusinessEmployeePath('/acme/employees/attendance')).toBe(true);
  });

  it('does not match reserved first segment', () => {
    expect(isPublicBusinessEmployeePath('/login/employees')).toBe(false);
  });
});
