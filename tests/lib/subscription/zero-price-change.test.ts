import { decideZeroPriceChange } from '@/lib/subscription/zero-price-change';

const paidRow = { plan_id: 'billing_business', status: 'active', trial_end_date: null };

describe('decideZeroPriceChange', () => {
  it('free plan from a paid plan must go through downgrade', () =>
    expect(
      decideZeroPriceChange({ moduleKey: 'billing', targetPlanId: 'free', current: paidRow, currentPlanIsPaid: true, trialAlreadyUsed: false }),
    ).toMatchObject({ action: 'reject', code: 'USE_DOWNGRADE' }));

  it('free plan from a trial applies at once', () =>
    expect(
      decideZeroPriceChange({
        moduleKey: 'billing',
        targetPlanId: 'free',
        current: { plan_id: 'trial', status: 'trial', trial_end_date: '2026-01-01' },
        currentPlanIsPaid: false,
        trialAlreadyUsed: false,
      }),
    ).toEqual({ action: 'apply_free' }));

  it('free plan with no current row applies', () =>
    expect(
      decideZeroPriceChange({ moduleKey: 'connect', targetPlanId: 'connect_free', current: null, currentPlanIsPaid: false, trialAlreadyUsed: false }),
    ).toEqual({ action: 'apply_free' }));

  it('first HR add starts a 30-day trial', () =>
    expect(
      decideZeroPriceChange({ moduleKey: 'hr', targetPlanId: 'hr_trial', current: null, currentPlanIsPaid: false, trialAlreadyUsed: false }),
    ).toEqual({ action: 'start_trial', trialDays: 30 }));

  it('HR trial cannot be taken twice', () =>
    expect(
      decideZeroPriceChange({
        moduleKey: 'hr',
        targetPlanId: 'hr_trial',
        current: { plan_id: 'hr_free', status: 'active', trial_end_date: null },
        currentPlanIsPaid: false,
        trialAlreadyUsed: true,
      }),
    ).toMatchObject({ action: 'reject', code: 'TRIAL_ALREADY_USED' }));

  it.each(['hr_free', 'hr_staff_lite'])('a business on %s with no trial history can start the HR trial', (planId) =>
    expect(
      decideZeroPriceChange({
        moduleKey: 'hr',
        targetPlanId: 'hr_trial',
        current: { plan_id: planId, status: 'active', trial_end_date: null },
        currentPlanIsPaid: false,
        trialAlreadyUsed: false,
      }),
    ).toEqual({ action: 'start_trial', trialDays: 30 }));

  it('a business on a paid HR plan cannot take the trial', () =>
    expect(
      decideZeroPriceChange({
        moduleKey: 'hr',
        targetPlanId: 'hr_trial',
        current: { plan_id: 'hr_pro', status: 'active', trial_end_date: null },
        currentPlanIsPaid: true,
        trialAlreadyUsed: false,
      }),
    ).toMatchObject({ action: 'reject', code: 'PLAN_NOT_SELECTABLE' }));

  it('used trial is refused even for a business with no current row', () =>
    expect(
      decideZeroPriceChange({
        moduleKey: 'hr',
        targetPlanId: 'hr_trial',
        current: null,
        currentPlanIsPaid: false,
        trialAlreadyUsed: true,
      }),
    ).toMatchObject({ action: 'reject', code: 'TRIAL_ALREADY_USED' }));

  it.each(['hr_staff_lite', 'hr_trial'])('billing module rejects %s', (p) =>
    expect(
      decideZeroPriceChange({ moduleKey: 'billing', targetPlanId: p, current: null, currentPlanIsPaid: false, trialAlreadyUsed: false }),
    ).toMatchObject({ action: 'reject', code: 'PLAN_NOT_SELECTABLE' }));

  it('connect has no trial', () =>
    expect(
      decideZeroPriceChange({ moduleKey: 'connect', targetPlanId: 'connect', current: null, currentPlanIsPaid: false, trialAlreadyUsed: false }),
    ).toMatchObject({ action: 'reject', code: 'PLAN_NOT_SELECTABLE' }));
});
