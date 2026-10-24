jest.mock('@/lib/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  queryRows: jest.fn(),
}));
jest.mock('@/lib/subscription', () => ({
  getBusinessSubscription: jest.fn(),
  clearSubscriptionCache: jest.fn(),
  checkLimit: jest.fn(),
}));

import { getBusinessSubscription } from '@/lib/subscription';
import { checkTrialExpiry } from '@/lib/subscription/lifecycle';
import {
  computeSubscriptionPeriodEnd,
  unusedTrialDays,
} from '@/lib/subscription/apply-plan-change';

const mockGetSub = getBusinessSubscription as jest.Mock;

function localDate(offsetDays: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

describe('checkTrialExpiry', () => {
  beforeEach(() => mockGetSub.mockReset());

  it('treats the trial end date as the last full day', async () => {
    mockGetSub.mockResolvedValue({ status: 'trial', trial_end_date: localDate(0), start_date: localDate(-29) });
    const info = await checkTrialExpiry('biz');
    expect(info.isExpired).toBe(false);
    expect(info.daysRemaining).toBe(1);
  });

  it('expires the day after the end date', async () => {
    mockGetSub.mockResolvedValue({ status: 'trial', trial_end_date: localDate(-1), start_date: localDate(-30) });
    const info = await checkTrialExpiry('biz');
    expect(info.isExpired).toBe(true);
    expect(info.daysRemaining).toBe(0);
  });

  it('counts remaining days inclusively', async () => {
    mockGetSub.mockResolvedValue({ status: 'trial', trial_end_date: localDate(9), start_date: localDate(-20) });
    const info = await checkTrialExpiry('biz');
    expect(info.daysRemaining).toBe(10);
  });

  it('falls back to start date plus signup trial length', async () => {
    mockGetSub.mockResolvedValue({ status: 'trial', trial_end_date: null, start_date: localDate(-10) });
    const info = await checkTrialExpiry('biz');
    expect(info.isExpired).toBe(false);
    expect(info.daysRemaining).toBe(21);
  });
});

describe('unusedTrialDays', () => {
  it('returns days after today for trial plans', () => {
    expect(unusedTrialDays({ plan_id: 'trial', trial_end_date: localDate(12) })).toBe(12);
    expect(unusedTrialDays({ plan_id: 'hr_trial', trial_end_date: localDate(3) })).toBe(3);
  });

  it('returns 0 on the last day, after expiry, or for non-trial plans', () => {
    expect(unusedTrialDays({ plan_id: 'trial', trial_end_date: localDate(0) })).toBe(0);
    expect(unusedTrialDays({ plan_id: 'trial', trial_end_date: localDate(-5) })).toBe(0);
    expect(unusedTrialDays({ plan_id: 'free', trial_end_date: localDate(10) })).toBe(0);
    expect(unusedTrialDays(null)).toBe(0);
  });
});

describe('computeSubscriptionPeriodEnd', () => {
  it('adds bonus days on top of the billing period', () => {
    const base = new Date(computeSubscriptionPeriodEnd('monthly'));
    const withBonus = new Date(computeSubscriptionPeriodEnd('monthly', 5));
    expect(Math.round((withBonus.getTime() - base.getTime()) / 86_400_000)).toBe(5);
  });
});
