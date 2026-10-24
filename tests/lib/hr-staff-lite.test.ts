import {
  getHrNavSectionTitle,
  getVisibleHrAdminNavItems,
  HR_LITE_NAV_SECTION_TITLE,
  HR_NAV_SECTION_TITLE,
} from '@/lib/hr/hr-admin-nav';
import { hrPlanFlags, isBeyondHrLite, isHrStaffLitePlanId } from '@/lib/subscription/hr-lite';
import { HR_STAFF_LITE_PLAN_ID } from '@/lib/product-lines';
import { isModuleOnFreePlan } from '@/lib/subscription/module-operational-check';
import type { ModuleSubscriptionRow } from '@/lib/subscription/module-subscriptions';

describe('HR Staff Lite', () => {
  it('recognizes the complimentary plan id', () => {
    expect(isHrStaffLitePlanId(HR_STAFF_LITE_PLAN_ID)).toBe(true);
    expect(isHrStaffLitePlanId('hr_pro')).toBe(false);
  });

  it('treats Staff Lite as a free/non-cancellable HR plan', () => {
    const row = {
      module_key: 'hr',
      plan_id: HR_STAFF_LITE_PLAN_ID,
      status: 'active',
    } as ModuleSubscriptionRow;
    expect(isModuleOnFreePlan(row)).toBe(true);
  });

  const LITE = ['hr_employees', 'hr_attendance', 'hr_payroll'];
  const STARTER = [...LITE, 'hr_staff_app', 'hr_shifts', 'hr_payroll_setup', 'hr_commissions'];
  const PRO = [...STARTER, 'hr_leaves', 'hr_employee_portal', 'hr_recruitment', 'hr_advanced'];
  const plan = (keys: string[]) => (k: string) => keys.includes(k);

  it('reads one switch per optional HR area', () => {
    expect(isBeyondHrLite(plan(LITE))).toBe(false);
    expect(isBeyondHrLite(plan(STARTER))).toBe(true);
    expect(hrPlanFlags(plan(STARTER))).toMatchObject({ staffApp: true, shifts: true, payrollSetup: true, leaves: false, portal: false });
  });

  it('Lite shows employees, attendance and salary only', () => {
    expect(getHrNavSectionTitle(plan(LITE))).toBe(HR_LITE_NAV_SECTION_TITLE);
    const hrefs = getVisibleHrAdminNavItems(plan(LITE)).map((i) => i.href);
    expect(hrefs).toEqual([
      '/employees',
      '/employees/new',
      '/employees/attendance',
      '/employees/salary/payments',
      '/employees/salary/advances',
    ]);
  });

  it('Starter adds shifts, expenses and commissions but not leave or hiring', () => {
    expect(getHrNavSectionTitle(plan(STARTER))).toBe(HR_NAV_SECTION_TITLE);
    const hrefs = getVisibleHrAdminNavItems(plan(STARTER)).map((i) => i.href);
    expect(hrefs).toEqual(expect.arrayContaining(['/hr/shifts/roster', '/employees/expenses', '/employees/commissions']));
    expect(hrefs).not.toContain('/employees/leaves');
    expect(hrefs).not.toContain('/employees/recruitment');
    expect(hrefs).not.toContain('/hr/dashboard');
  });

  it('Pro shows every HR destination', () => {
    const hrefs = getVisibleHrAdminNavItems(plan(PRO)).map((i) => i.href);
    expect(hrefs).toEqual(expect.arrayContaining(['/employees/leaves', '/employees/recruitment', '/hr/dashboard', '/activity-logs']));
  });
});
