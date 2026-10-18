jest.mock('@/lib/user-module-permissions', () => ({ loadUserModulePermissions: jest.fn() }));
jest.mock('@/lib/subscription/feature-access', () => ({ getAllFeatureAccessForBusiness: jest.fn() }));
jest.mock('@/lib/business-modules', () => ({ getBusinessPlatformContext: jest.fn() }));

import { buildHrNavSectionForSnapshot, loadHrNavSectionForUser } from '@/lib/hr/hr-nav-for-user';
import { HR_LITE_NAV_SECTION_TITLE, HR_NAV_SECTION_TITLE } from '@/lib/hr/hr-admin-nav';
import { loadUserModulePermissions } from '@/lib/user-module-permissions';
import { getAllFeatureAccessForBusiness } from '@/lib/subscription/feature-access';
import { getBusinessPlatformContext } from '@/lib/business-modules';

const LITE = ['hr_employees', 'hr_attendance', 'hr_payroll'];
const STARTER = [...LITE, 'hr_staff_app', 'hr_shifts', 'hr_payroll_setup', 'hr_commissions'];
const PRO = [...STARTER, 'hr_leaves', 'hr_employee_portal', 'hr_recruitment', 'hr_advanced'];
const view = { can_view: true, can_add: false, can_modify: false, can_delete: false, can_share: false };

const owner = (enabledFeatures: string[]) => ({ permissions: {}, isPrimaryAdmin: true, enabledFeatures });
const hrefs = (section: ReturnType<typeof buildHrNavSectionForSnapshot>) => section?.items.map((i) => i.href) ?? [];

describe('HR menu built on the server', () => {
  it('leaves out the HR dashboard when the plan has no HR workspace', () => {
    const section = buildHrNavSectionForSnapshot(owner(STARTER), ['billing', 'hr']);
    expect(section?.title).toBe(HR_NAV_SECTION_TITLE);
    expect(hrefs(section)).not.toContain('/hr/dashboard');
    expect(hrefs(section)).not.toContain('/employees/org-chart');
    expect(hrefs(section)).toContain('/employees/commissions');
  });

  it('shows the HR dashboard on a plan with the HR workspace', () => {
    expect(hrefs(buildHrNavSectionForSnapshot(owner(PRO), ['billing', 'hr']))).toContain('/hr/dashboard');
  });

  it('titles a Lite-only plan Staff', () => {
    const section = buildHrNavSectionForSnapshot(owner(LITE), ['billing', 'hr']);
    expect(section?.title).toBe(HR_LITE_NAV_SECTION_TITLE);
    expect(hrefs(section)).toEqual([
      '/employees',
      '/employees/new',
      '/employees/attendance',
      '/employees/salary/payments',
      '/employees/salary/advances',
    ]);
  });

  it('returns nothing when the business has no HR module', () => {
    expect(buildHrNavSectionForSnapshot(owner(PRO), ['billing'])).toBeNull();
  });

  it('hides items the role cannot open', () => {
    const staff = { permissions: { attendance: view }, isPrimaryAdmin: false, enabledFeatures: PRO };
    expect(hrefs(buildHrNavSectionForSnapshot(staff, ['hr']))).toEqual([
      '/employees/attendance',
      '/hr/shifts/roster',
      '/hr/shifts/bulk-assign',
    ]);
  });

  it('loads permissions, plan features and modules for the user', async () => {
    (loadUserModulePermissions as jest.Mock).mockResolvedValue({ permissions: {}, isPrimaryAdmin: true });
    (getAllFeatureAccessForBusiness as jest.Mock).mockResolvedValue(new Set(STARTER));
    (getBusinessPlatformContext as jest.Mock).mockResolvedValue({ enabledModules: ['billing', 'hr'] });

    const section = await loadHrNavSectionForUser('biz-1', 'user-1');
    expect(getAllFeatureAccessForBusiness).toHaveBeenCalledWith('biz-1');
    expect(loadUserModulePermissions).toHaveBeenCalledWith('user-1');
    expect(hrefs(section)).not.toContain('/hr/dashboard');
  });
});
