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
