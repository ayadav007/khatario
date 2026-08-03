import {
  parseHrOrgCatalog,
  DEFAULT_HR_ORG_CATALOG,
} from '@/lib/hr/hr-org-catalog';
import {
  parseHrPayrollSettings,
  DEFAULT_HR_PAYROLL_SETTINGS,
} from '@/lib/hr/hr-payroll-settings';
import {
  parseHrHiringSettings,
  DEFAULT_HR_HIRING_SETTINGS,
} from '@/lib/hr/hr-hiring-settings';
import {
  parseHrPortalSettings,
  DEFAULT_HR_PORTAL_SETTINGS,
} from '@/lib/hr/hr-portal-settings';

describe('hr-org-catalog', () => {
  it('returns defaults for invalid input', () => {
    expect(parseHrOrgCatalog(null)).toEqual(DEFAULT_HR_ORG_CATALOG);
    expect(parseHrOrgCatalog('x')).toEqual(DEFAULT_HR_ORG_CATALOG);
  });

  it('normalizes and dedupes department lists', () => {
    expect(
      parseHrOrgCatalog({
        departments: [' Sales ', 'sales', 'Engineering', ''],
        designations: ['Manager', 42, 'Manager'],
      }),
    ).toEqual({
      departments: ['Engineering', 'Sales'],
      designations: ['Manager'],
    });
  });
});

describe('hr-payroll-settings', () => {
  it('returns defaults for invalid input', () => {
    expect(parseHrPayrollSettings(null)).toEqual(DEFAULT_HR_PAYROLL_SETTINGS);
  });

  it('accepts valid pay day 1–28', () => {
    expect(parseHrPayrollSettings({ monthly_pay_day: 15 })).toEqual({ monthly_pay_day: 15 });
    expect(parseHrPayrollSettings({ monthly_pay_day: '7' })).toEqual({ monthly_pay_day: 7 });
  });

  it('rejects out-of-range pay day', () => {
    expect(parseHrPayrollSettings({ monthly_pay_day: 0 })).toEqual({ monthly_pay_day: null });
    expect(parseHrPayrollSettings({ monthly_pay_day: 31 })).toEqual({ monthly_pay_day: null });
    expect(parseHrPayrollSettings({ monthly_pay_day: null })).toEqual({ monthly_pay_day: null });
  });
});

describe('hr-hiring-settings', () => {
  it('defaults auto invite to false', () => {
    expect(parseHrHiringSettings({})).toEqual(DEFAULT_HR_HIRING_SETTINGS);
    expect(parseHrHiringSettings({ auto_send_onboarding_invite: true })).toEqual({
      auto_send_onboarding_invite: true,
    });
  });
});

describe('hr-portal-settings', () => {
  it('defaults kiosk to enabled', () => {
    expect(parseHrPortalSettings({})).toEqual(DEFAULT_HR_PORTAL_SETTINGS);
    expect(parseHrPortalSettings({ kiosk_enabled: false })).toEqual({ kiosk_enabled: false });
  });
});
