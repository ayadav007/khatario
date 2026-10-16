import { bundledHrDecision } from '@/lib/subscription/hr-bundle';

const decide = (currentPlanId: string | null, currentSource: string | null, bundledPlanId: string | null) =>
  bundledHrDecision({ currentPlanId, currentSource, bundledPlanId });

describe('bundled HR decision', () => {
  it('gives a new Billing business the HR plan bundled with its plan', () => {
    expect(decide(null, null, 'hr_starter')).toEqual({ action: 'set', planId: 'hr_starter' });
  });

  it('gives a Free business HR Free when it has no HR yet', () => {
    expect(decide(null, null, null)).toEqual({ action: 'set', planId: 'hr_free' });
  });

  it('moves bundled HR up and down with the Billing plan', () => {
    expect(decide('hr_staff_lite', 'complimentary', 'hr_pro')).toEqual({ action: 'set', planId: 'hr_pro' });
    expect(decide('hr_pro', 'complimentary', 'hr_staff_lite')).toEqual({ action: 'set', planId: 'hr_staff_lite' });
    expect(decide('hr_starter', 'complimentary', 'hr_starter')).toEqual({ action: 'keep' });
  });

  it('drops bundled HR to HR Free when the Billing plan has no bundle', () => {
    expect(decide('hr_starter', 'complimentary', null)).toEqual({ action: 'set', planId: 'hr_free' });
  });

  it('keeps HR bought separately unless the bundle is better', () => {
    expect(decide('hr_starter', 'upgrade', 'hr_staff_lite')).toEqual({ action: 'keep' });
    expect(decide('hr_starter', 'upgrade', null)).toEqual({ action: 'keep' });
    expect(decide('hr_starter', 'upgrade', 'hr_pro')).toEqual({ action: 'set', planId: 'hr_pro' });
  });

  it('never touches an HR trial', () => {
    expect(decide('hr_trial', 'upgrade', 'hr_pro')).toEqual({ action: 'keep' });
    expect(decide('hr_trial', 'complimentary', null)).toEqual({ action: 'keep' });
  });
});
