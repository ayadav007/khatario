import { describe, expect, it } from 'vitest';
import {
  getSignupHref,
  getSignupPlanConfig,
  isNavSectionHiddenForProductLine,
  normalizeProductLine,
} from '@/lib/product-lines';

describe('product-lines', () => {
  it('normalizes unknown values to billing', () => {
    expect(normalizeProductLine(undefined)).toBe('billing');
    expect(normalizeProductLine('hr')).toBe('hr');
    expect(normalizeProductLine('invalid')).toBe('billing');
  });

  it('builds signup href with product query', () => {
    expect(getSignupHref('hr')).toBe('/signup?product=hr');
  });

  it('maps HR signup to hr_trial', () => {
    expect(getSignupPlanConfig('hr')).toMatchObject({
      planId: 'hr_trial',
      status: 'trial',
      postTrialPlanId: 'hr_free',
    });
  });

  it('maps Connect signup to free connect plan', () => {
    expect(getSignupPlanConfig('connect')).toMatchObject({
      planId: 'connect',
      status: 'active',
      trialDays: null,
    });
  });

  it('hides billing nav sections for HR product line', () => {
    expect(isNavSectionHiddenForProductLine('Sales', 'hr')).toBe(true);
    expect(isNavSectionHiddenForProductLine('HR & Employees', 'hr')).toBe(false);
    expect(isNavSectionHiddenForProductLine('HR & Employees', 'connect')).toBe(true);
  });
});
