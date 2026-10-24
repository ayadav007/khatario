jest.mock('@/lib/user-module-permissions', () => ({ loadUserModulePermissions: jest.fn() }));
jest.mock('@/lib/subscription/feature-access', () => ({ getAllFeatureAccessForBusiness: jest.fn() }));
jest.mock('@/lib/business-modules', () => ({ getBusinessPlatformContext: jest.fn() }));
jest.mock('@/lib/db', () => ({ queryOne: jest.fn() }));

import { buildMoreMenuForSnapshot, loadMoreMenuForUser } from '@/lib/navigation/more-menu-for-user';
import { HR_LITE_NAV_SECTION_TITLE, HR_NAV_SECTION_TITLE } from '@/lib/hr/hr-admin-nav';
import { loadUserModulePermissions } from '@/lib/user-module-permissions';
import { getAllFeatureAccessForBusiness } from '@/lib/subscription/feature-access';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import { queryOne } from '@/lib/db';
import type { PlatformModule } from '@/lib/platform-modules';

jest.spyOn(console, 'warn').mockImplementation(() => {});

const LITE = ['hr_employees', 'hr_attendance', 'hr_payroll'];
const STARTER = [...LITE, 'hr_staff_app', 'hr_shifts', 'hr_payroll_setup', 'hr_commissions'];
const PRO = [...STARTER, 'hr_leaves', 'hr_employee_portal', 'hr_recruitment', 'hr_advanced'];
const view = { can_view: true, can_add: false, can_modify: false, can_delete: false, can_share: false };

const owner = (enabledFeatures: string[]) => ({ permissions: {}, isPrimaryAdmin: true, enabledFeatures });
const flags = (enabledModules: PlatformModule[], extra: Partial<{ isSupplier: boolean; warehousesEnabled: boolean }> = {}) => ({
  isSupplier: false,
  warehousesEnabled: false,
  enabledModules,
  ...extra,
});
const sectionOf = (sections: ReturnType<typeof buildMoreMenuForSnapshot>, title: string) =>
  sections.find((s) => s.title === title);
const hrefsOf = (sections: ReturnType<typeof buildMoreMenuForSnapshot>, title: string) =>
  sectionOf(sections, title)?.items.map((i) => i.href) ?? [];

describe('More menu built on the server', () => {
  it('leaves out the HR dashboard when the plan has no HR workspace', () => {
    const menu = buildMoreMenuForSnapshot(owner(STARTER), flags(['billing', 'hr']));
    expect(sectionOf(menu, HR_NAV_SECTION_TITLE)).toBeDefined();
    expect(hrefsOf(menu, HR_NAV_SECTION_TITLE)).not.toContain('/hr/dashboard');
    expect(hrefsOf(menu, HR_NAV_SECTION_TITLE)).toContain('/employees/commissions');
  });

  it('shows the HR dashboard on a plan with the HR workspace', () => {
    expect(hrefsOf(buildMoreMenuForSnapshot(owner(PRO), flags(['billing', 'hr'])), HR_NAV_SECTION_TITLE)).toContain(
      '/hr/dashboard',
    );
  });

  it('titles a Lite-only plan Staff', () => {
    const menu = buildMoreMenuForSnapshot(owner(LITE), flags(['billing', 'hr']));
    expect(hrefsOf(menu, HR_LITE_NAV_SECTION_TITLE)).toEqual([
      '/employees',
      '/employees/new',
      '/employees/attendance',
      '/employees/salary/payments',
      '/employees/salary/advances',
    ]);
  });

  it('hides sections whose module the business does not have', () => {
    const menu = buildMoreMenuForSnapshot(owner(PRO), flags(['billing']));
    expect(sectionOf(menu, HR_NAV_SECTION_TITLE)).toBeUndefined();
    expect(sectionOf(menu, 'Connect')).toBeUndefined();
    expect(hrefsOf(menu, 'WhatsApp')).toEqual(['/settings/whatsapp']);
  });

  it('shows Connect with locks when the plan has no WhatsApp bot', () => {
    const menu = buildMoreMenuForSnapshot(owner([]), flags(['billing', 'connect']));
    const connect = sectionOf(menu, 'Connect');
    expect(connect?.items.find((i) => i.href === '/whatsapp/dashboard')?.isLocked).toBe(true);
    expect(connect?.items.map((i) => i.href)).toContain('/whatsapp/who-to-message');
  });

  it('adds the Supplier section and warehouse links only when they apply', () => {
    expect(sectionOf(buildMoreMenuForSnapshot(owner([]), flags(['billing'])), 'Supplier')).toBeUndefined();
    const menu = buildMoreMenuForSnapshot(owner([]), flags(['billing'], { isSupplier: true, warehousesEnabled: true }));
    expect(hrefsOf(menu, 'Supplier')).toContain('/supply-orders?role=vendor');
    expect(hrefsOf(menu, 'Inventory')).toContain('/stock-transfers');
  });

  it('hides items the role cannot open', () => {
    const staff = { permissions: { attendance: view }, isPrimaryAdmin: false, enabledFeatures: PRO };
    const menu = buildMoreMenuForSnapshot(staff, flags(['billing', 'hr']));
    expect(sectionOf(menu, 'Accounting')).toBeUndefined();
    expect(hrefsOf(menu, HR_NAV_SECTION_TITLE)).toEqual([
      '/employees/attendance',
      '/hr/shifts/roster',
      '/hr/shifts/bulk-assign',
    ]);
  });

  it('loads permissions, plan, modules, supplier status and warehouses for the user', async () => {
    (loadUserModulePermissions as jest.Mock).mockResolvedValue({ permissions: {}, isPrimaryAdmin: true });
    (getAllFeatureAccessForBusiness as jest.Mock).mockResolvedValue(new Set(STARTER));
    (getBusinessPlatformContext as jest.Mock).mockResolvedValue({ enabledModules: ['billing', 'hr'] });
    (queryOne as jest.Mock).mockImplementation(async (sql: string) =>
      sql.includes('suppliers') ? { found: true } : { warehouses_enabled: true },
    );

    const menu = await loadMoreMenuForUser('biz-1', 'user-1');
    expect(getAllFeatureAccessForBusiness).toHaveBeenCalledWith('biz-1');
    expect(loadUserModulePermissions).toHaveBeenCalledWith('user-1');
    expect(sectionOf(menu, 'Supplier')).toBeDefined();
    expect(hrefsOf(menu, 'Inventory')).toContain('/settings/warehouses');
    expect(hrefsOf(menu, HR_NAV_SECTION_TITLE)).not.toContain('/hr/dashboard');
  });
});
