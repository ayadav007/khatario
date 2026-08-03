import { describe, it, expect } from '@jest/globals';
import {
  resolvePlatformModuleForAuthModule,
  PERMISSION_MODULE_PLATFORM,
} from '@/lib/rbac-permission-catalog';

describe('resolvePlatformModuleForAuthModule', () => {
  it('maps billing RBAC modules to billing platform module', () => {
    expect(resolvePlatformModuleForAuthModule('invoices')).toBe('billing');
    expect(resolvePlatformModuleForAuthModule('customers')).toBe('billing');
    expect(resolvePlatformModuleForAuthModule('dashboard')).toBe('billing');
    expect(resolvePlatformModuleForAuthModule('reports')).toBe('billing');
  });

  it('maps HR RBAC modules to hr platform module', () => {
    expect(resolvePlatformModuleForAuthModule('employees')).toBe('hr');
    expect(resolvePlatformModuleForAuthModule('payroll')).toBe('hr');
    expect(resolvePlatformModuleForAuthModule('recruitment')).toBe('hr');
    expect(resolvePlatformModuleForAuthModule('attendance')).toBe('hr');
  });

  it('maps connect RBAC modules to connect platform module', () => {
    expect(resolvePlatformModuleForAuthModule('whatsapp')).toBe('connect');
  });

  it('leaves core modules ungated', () => {
    expect(resolvePlatformModuleForAuthModule('settings')).toBe('core');
    expect(resolvePlatformModuleForAuthModule('tools')).toBe('core');
  });

  it('dashboard is billing-gated in catalog', () => {
    expect(PERMISSION_MODULE_PLATFORM.dashboard).toBe('billing');
  });
});
