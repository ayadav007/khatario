import './helpers/mock-subscription-deps';

import {
  requireOperationalSubscription,
  OperationalSubscriptionError,
} from '@/lib/security/require-operational-subscription';
import {
  SUBSCRIPTION_SCENARIOS,
} from './fixtures/subscription-scenarios';
import {
  applySubscriptionScenario,
  mockGetBusinessSubscription,
  resetSubscriptionMocks,
} from './helpers/mock-subscription-deps';
import { BUSINESS_A } from './fixtures/identities';

describe('requireOperationalSubscription', () => {
  beforeEach(() => {
    resetSubscriptionMocks();
  });

  it.each(SUBSCRIPTION_SCENARIOS)(
    '$label — gate status $expectedGateStatus',
    async (scenario) => {
      applySubscriptionScenario(scenario);

      if (scenario.expectedGateStatus === 200) {
        const sub = await requireOperationalSubscription(BUSINESS_A);
        expect(sub.status).toBe(scenario.subscription?.status);
        return;
      }

      await expect(requireOperationalSubscription(BUSINESS_A)).rejects.toMatchObject({
        statusCode: 403,
        code: scenario.expectedCode,
      });
    },
  );

  it('maps expired paid plan via past end_date to SUBSCRIPTION_EXPIRED', async () => {
    applySubscriptionScenario({
      id: 'expired',
      label: 'past end_date',
      expectedGateStatus: 403,
      expectedCode: 'SUBSCRIPTION_EXPIRED',
      subscription: {
        subscription_id: 'sub-1',
        business_id: BUSINESS_A,
        plan_id: 'pro',
        status: 'active',
        start_date: '2023-01-01',
        end_date: '2020-01-01',
        trial_end_date: null,
        plan_name: 'pro',
        plan_display_name: 'Pro',
        features: { limits: {}, features: {} },
        scheduled_plan_id: null,
        billing_cycle: 'monthly',
      },
    });

    await expect(requireOperationalSubscription(BUSINESS_A)).rejects.toBeInstanceOf(
      OperationalSubscriptionError,
    );
    await expect(requireOperationalSubscription(BUSINESS_A)).rejects.toMatchObject({
      code: 'SUBSCRIPTION_EXPIRED',
    });
  });

  describe('paid grace counts from end_date (no nightly stamp needed)', () => {
    const dayOffset = (n: number) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + n);
      const p = (x: number) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    const paidRow = (extra: Record<string, unknown>) => ({
      subscription_id: 'sub-1',
      business_id: BUSINESS_A,
      plan_id: 'pro',
      status: 'active',
      start_date: '2023-01-01',
      trial_end_date: null,
      plan_name: 'pro',
      plan_display_name: 'Pro',
      features: { limits: {}, features: {} },
      scheduled_plan_id: null,
      billing_cycle: 'monthly',
      grace_period_end: null,
      cancel_at_period_end: false,
      ...extra,
    });
    const apply = (row: Record<string, unknown>, expectedGateStatus: 200 | 403) =>
      applySubscriptionScenario({
        id: 'grace',
        label: 'grace',
        expectedGateStatus,
        expectedCode: 'SUBSCRIPTION_EXPIRED',
        subscription: row as any,
      });

    it('allows the day after end_date with no grace stamp', async () => {
      apply(paidRow({ end_date: dayOffset(-1) }), 200);
      await expect(requireOperationalSubscription(BUSINESS_A)).resolves.toBeDefined();
    });

    it('allows on day 7 after end_date and denies on day 8', async () => {
      apply(paidRow({ end_date: dayOffset(-7) }), 200);
      await expect(requireOperationalSubscription(BUSINESS_A)).resolves.toBeDefined();
      apply(paidRow({ end_date: dayOffset(-8) }), 403);
      await expect(requireOperationalSubscription(BUSINESS_A)).rejects.toMatchObject({ code: 'SUBSCRIPTION_EXPIRED' });
    });

    it('denies a cancelled-at-period-end row the day after end_date (unchanged)', async () => {
      apply(paidRow({ end_date: dayOffset(-1), cancel_at_period_end: true }), 403);
      await expect(requireOperationalSubscription(BUSINESS_A)).rejects.toMatchObject({ code: 'SUBSCRIPTION_EXPIRED' });
    });

    it('denies a row with a scheduled downgrade the day after end_date (unchanged)', async () => {
      apply(paidRow({ end_date: dayOffset(-1), scheduled_plan_id: 'starter' }), 403);
      await expect(requireOperationalSubscription(BUSINESS_A)).rejects.toMatchObject({ code: 'SUBSCRIPTION_EXPIRED' });
    });
  });

  describe('protection regression', () => {
    it('fails closed when subscription lookup returns null (expired tenant)', async () => {
      applySubscriptionScenario({
        id: 'expired',
        label: 'expired',
        expectedGateStatus: 403,
        subscription: null,
      });

      await expect(requireOperationalSubscription(BUSINESS_A)).rejects.toThrow(
        OperationalSubscriptionError,
      );
    });

    it('would allow access if getBusinessSubscription bypass is simulated (removed protection)', async () => {
      mockGetBusinessSubscription.mockResolvedValue({
        subscription_id: 'sub-1',
        business_id: BUSINESS_A,
        plan_id: 'pro',
        status: 'active',
        start_date: '2024-01-01',
        end_date: null,
        trial_end_date: null,
        plan_name: 'pro',
        plan_display_name: 'Pro',
        features: { limits: {}, features: {} },
        scheduled_plan_id: null,
        billing_cycle: 'monthly',
      });

      await expect(requireOperationalSubscription(BUSINESS_A)).resolves.toBeDefined();
    });
  });
});
