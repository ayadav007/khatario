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
