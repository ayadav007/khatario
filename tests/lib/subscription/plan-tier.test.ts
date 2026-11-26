import { getPlanChangeAction } from '@/lib/subscription/trial-plan';
import { comparePlanTier, planTierRank, FREE_TIER_PLAN_IDS } from '@/lib/subscription/plan-tier';

describe('getPlanChangeAction (tier order, never price)', () => {
  it('connect is an upgrade from connect_free', () =>
    expect(getPlanChangeAction({ id: 'connect_free', sort_order: 21 }, { id: 'connect', sort_order: 20 })).toBe('upgrade'));
  it('hr_free is a downgrade from hr_pro', () =>
    expect(getPlanChangeAction({ id: 'hr_pro', sort_order: 11 }, { id: 'hr_free', sort_order: 13 })).toBe('downgrade'));
  it('hr_pro is an upgrade from hr_staff_lite', () =>
    expect(getPlanChangeAction({ id: 'hr_staff_lite', sort_order: 9 }, { id: 'hr_pro', sort_order: 11 })).toBe('upgrade'));
  it('starter is a downgrade from business', () =>
    expect(getPlanChangeAction({ id: 'billing_business', sort_order: 4 }, { id: 'billing_starter', sort_order: 2 })).toBe('downgrade'));
  it('same plan is current', () =>
    expect(getPlanChangeAction({ id: 'billing_business', sort_order: 4 }, { id: 'billing_business', sort_order: 4 })).toBe('current'));
  it('trial to paid is an upgrade, trial to free is a downgrade', () => {
    expect(getPlanChangeAction({ id: 'trial', sort_order: 99 }, { id: 'billing_starter', sort_order: 2 })).toBe('upgrade');
    expect(getPlanChangeAction({ id: 'trial', sort_order: 99 }, { id: 'free', sort_order: 50 })).toBe('downgrade');
  });
  it('anything to trial is a downgrade', () =>
    expect(getPlanChangeAction({ id: 'billing_starter', sort_order: 2 }, { id: 'trial', sort_order: 99 })).toBe('downgrade'));
});

describe('plan tier helpers', () => {
  it('free-tier plans rank 0 whatever their sort_order', () => {
    for (const id of ['free', 'hr_free', 'hr_staff_lite', 'connect_free']) {
      expect(FREE_TIER_PLAN_IDS.has(id)).toBe(true);
      expect(planTierRank({ id, sort_order: 21 })).toBe(0);
    }
  });
  it('other plans rank sort_order + 1 and compare accordingly', () => {
    expect(planTierRank({ id: 'connect', sort_order: 20 })).toBe(21);
    expect(comparePlanTier({ id: 'a', sort_order: 1 }, { id: 'b', sort_order: 2 })).toBe(-1);
    expect(comparePlanTier({ id: 'b', sort_order: 2 }, { id: 'a', sort_order: 1 })).toBe(1);
    expect(comparePlanTier({ id: 'a', sort_order: 2 }, { id: 'b', sort_order: 2 })).toBe(0);
  });
});
