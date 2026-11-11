import { shouldBlockWeb } from '@/lib/upgrade/web-gate';

describe('shouldBlockWeb', () => {
  it('blocks a Free business in a browser', () => {
    expect(shouldBlockWeb({ allowed: false, inPhoneApp: false, pathname: '/dashboard' })).toBe(true);
  });

  it('never blocks inside the phone app', () => {
    expect(shouldBlockWeb({ allowed: false, inPhoneApp: true, pathname: '/dashboard' })).toBe(false);
  });

  it('keeps the plan and payment pages open', () => {
    expect(shouldBlockWeb({ allowed: false, inPhoneApp: false, pathname: '/settings/subscription' })).toBe(false);
    expect(shouldBlockWeb({ allowed: false, inPhoneApp: false, pathname: '/settings/subscription/checkout' })).toBe(false);
    expect(shouldBlockWeb({ allowed: false, inPhoneApp: false, pathname: '/upgrade' })).toBe(false);
  });

  it('does not block while the check is loading or allowed', () => {
    expect(shouldBlockWeb({ allowed: null, inPhoneApp: false, pathname: '/dashboard' })).toBe(false);
    expect(shouldBlockWeb({ allowed: true, inPhoneApp: false, pathname: '/dashboard' })).toBe(false);
  });
});
