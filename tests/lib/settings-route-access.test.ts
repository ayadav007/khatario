import {
  canAccessSettingsPath,
  requiredModulesForSettingsPath,
} from '@/lib/settings-route-access';

describe('settings-route-access', () => {
  it('allows settings hub for any module set', () => {
    expect(canAccessSettingsPath('/settings', ['hr'])).toBe(true);
  });

  it('billing-only path requires billing', () => {
    expect(requiredModulesForSettingsPath('/settings/templates')).toContain('billing');
    expect(canAccessSettingsPath('/settings/templates', ['hr'])).toBe(false);
    expect(canAccessSettingsPath('/settings/templates', ['billing'])).toBe(true);
  });

  it('shared path allows any module that lists it', () => {
    expect(requiredModulesForSettingsPath('/settings/business')).toEqual(
      expect.arrayContaining(['hr', 'billing', 'connect']),
    );
    expect(canAccessSettingsPath('/settings/business', ['hr'])).toBe(true);
    expect(canAccessSettingsPath('/settings/business', ['billing'])).toBe(true);
    expect(canAccessSettingsPath('/settings/business', ['connect'])).toBe(true);
    expect(canAccessSettingsPath('/settings/templates', ['crm'])).toBe(false);
  });

  it('financial years allowed for hr and billing', () => {
    expect(canAccessSettingsPath('/settings/financial-years', ['hr'])).toBe(true);
    expect(canAccessSettingsPath('/settings/financial-years', ['billing'])).toBe(true);
  });

  it('hr payroll settings path requires hr', () => {
    expect(canAccessSettingsPath('/settings/commission-rules', ['hr'])).toBe(true);
    expect(canAccessSettingsPath('/settings/commission-rules', ['billing'])).toBe(false);
    expect(canAccessSettingsPath('/settings/payroll', ['hr'])).toBe(true);
    expect(canAccessSettingsPath('/settings/payroll', ['billing'])).toBe(false);
    expect(canAccessSettingsPath('/settings/departments', ['hr'])).toBe(true);
    expect(canAccessSettingsPath('/settings/employee-portal', ['hr'])).toBe(true);
    expect(canAccessSettingsPath('/settings/hiring', ['billing'])).toBe(false);
  });

  it('nested branch routes inherit parent module', () => {
    expect(canAccessSettingsPath('/settings/branches/new', ['hr'])).toBe(true);
    expect(canAccessSettingsPath('/settings/branches/new', ['billing'])).toBe(true);
    expect(canAccessSettingsPath('/settings/warehouses/new', ['hr'])).toBe(false);
  });
});
