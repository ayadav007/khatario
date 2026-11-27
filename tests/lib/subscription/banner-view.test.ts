import { bannerCompactMessage, bannerCta, bannerMessage } from '@/lib/subscription/banner-view';

describe('subscription banner words', () => {
  it('in grace the banner says the plan ended, with the server dates, and never "Trial ends"', () => {
    const full = bannerMessage({ kind: 'grace_expiring', daysRemaining: 5, endsOn: '2026-11-25', graceEndsOn: '2026-12-02' });
    expect(full).toBe('Your plan ended on 25 Nov 2026. You can keep using it until 2 Dec 2026. Renew to continue; after that your account moves to the Free plan.');
    const compact = bannerCompactMessage({ kind: 'grace_expiring', daysRemaining: 5 });
    expect(compact).toBe('Plan ended — renew within 5d to keep access');
    expect(`${full} ${compact}`).not.toMatch(/trial/i);
  });
  it('grace with no dates falls back to the days the server counted', () => {
    expect(bannerMessage({ kind: 'grace_expiring', daysRemaining: 1 })).toMatch(/Your plan has ended\. You can keep using it for 1 day more\./);
    expect(bannerCompactMessage({ kind: 'grace_expiring', daysRemaining: 0 })).toBe('Plan ended — renew to keep access');
  });
  it('a trial still says trial', () => {
    expect(bannerCompactMessage({ kind: 'trial_ending', daysRemaining: 3 })).toBe('Trial ends in 3d — upgrade to keep access');
    expect(bannerMessage({ kind: 'trial_ending', daysRemaining: 0 })).toMatch(/last day of your trial/);
    expect(bannerMessage({ kind: 'trial_ending', daysRemaining: 1 })).toBe('Your trial ends in 1 day. Upgrade to keep full access.');
  });
  it('grace asks to renew, not to choose a plan', () => {
    expect(bannerCta('grace_expiring')).toBe('Renew now');
    expect(bannerCta('trial_ending')).toBe('Choose a plan');
    expect(bannerCta('cancelled')).toBe('Reactivate');
  });
});
