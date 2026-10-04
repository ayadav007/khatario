import {
  getHrNavSectionTitle,
  getVisibleHrAdminNavItems,
  HR_LITE_NAV_SECTION_TITLE,
  HR_NAV_SECTION_TITLE,
} from '@/lib/hr/hr-admin-nav';
import { hasFullHrFeatures, isHrStaffLitePlanId } from '@/lib/subscription/hr-lite';
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

  it('detects full HR from leave or portal features', () => {
    expect(hasFullHrFeatures((k) => k === 'hr_employees')).toBe(false);
    expect(hasFullHrFeatures((k) => k === 'hr_leaves')).toBe(true);
    expect(hasFullHrFeatures((k) => k === 'hr_employee_portal')).toBe(true);
  });

  it('shows Staff nav and hides full-HR destinations on Lite', () => {
    const lite = (k: string) =>
      ['hr_employees', 'hr_attendance', 'hr_payroll'].includes(k);
    expect(getHrNavSectionTitle(lite)).toBe(HR_LITE_NAV_SECTION_TITLE);
    const hrefs = getVisibleHrAdminNavItems(lite).map((i) => i.href);
    expect(hrefs).toContain('/employees');
    expect(hrefs).toContain('/employees/attendance');
    expect(hrefs).toContain('/employees/salary/payments');
    expect(hrefs).not.toContain('/employees/leaves');
    expect(hrefs).not.toContain('/employees/recruitment');
    expect(hrefs).not.toContain('/hr/shifts/roster');
    expect(hrefs).not.toContain('/hr/dashboard');
    expect(hrefs).not.toContain('/activity-logs');
  });

  it('shows full HR nav when leave is enabled', () => {
    const full = (k: string) =>
      ['hr_employees', 'hr_attendance', 'hr_payroll', 'hr_leaves', 'hr_employee_portal'].includes(
        k,
      );
    expect(getHrNavSectionTitle(full)).toBe(HR_NAV_SECTION_TITLE);
    const hrefs = getVisibleHrAdminNavItems(full).map((i) => i.href);
    expect(hrefs).toContain('/employees/leaves');
    expect(hrefs).toContain('/employees/recruitment');
  });
});
