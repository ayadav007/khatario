import type { BusinessSubscription } from '@/lib/subscription';

export type SubscriptionScenarioId =
  | 'active'
  | 'freePlan'
  | 'expired'
  | 'expiredTrial'
  | 'cancelled'
  | 'suspended';

export interface SubscriptionScenarioConfig {
  id: SubscriptionScenarioId;
  label: string;
  /** Expected HTTP status at the premium API gate. */
  expectedGateStatus: number;
  expectedCode?: string;
  suspended?: boolean;
  subscription?: BusinessSubscription | null;
  trialExpiry?: {
    isExpired: boolean;
    isInGracePeriod: boolean;
    daysRemaining: number;
    graceEndsAt: null;
  };
}

const baseSubscription = (
  overrides: Partial<BusinessSubscription>,
): BusinessSubscription =>
  ({
    subscription_id: 'sub-1',
    business_id: 'biz-1',
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
    ...overrides,
  }) as BusinessSubscription;

export const SUBSCRIPTION_SCENARIOS: SubscriptionScenarioConfig[] = [
  {
    id: 'active',
    label: 'Active subscription',
    expectedGateStatus: 200,
    subscription: baseSubscription({ status: 'active', plan_id: 'pro' }),
  },
  {
    id: 'freePlan',
    label: 'Free plan (operational active)',
    expectedGateStatus: 200,
    subscription: baseSubscription({ status: 'active', plan_id: 'free' }),
  },
  {
    id: 'expired',
    label: 'Expired subscription (no row / past end)',
    expectedGateStatus: 403,
    expectedCode: 'NO_SUBSCRIPTION',
    subscription: null,
  },
  {
    id: 'expiredTrial',
    label: 'Expired trial calendar',
    expectedGateStatus: 403,
    expectedCode: 'TRIAL_EXPIRED',
    subscription: baseSubscription({
      status: 'trial',
      plan_id: 'trial',
      trial_end_date: '2020-01-01',
    }),
    trialExpiry: {
      isExpired: true,
      isInGracePeriod: false,
      daysRemaining: 0,
      graceEndsAt: null,
    },
  },
  {
    id: 'cancelled',
    label: 'Cancelled subscription',
    expectedGateStatus: 403,
    expectedCode: 'SUBSCRIPTION_CANCELLED',
    subscription: baseSubscription({ status: 'cancelled' as BusinessSubscription['status'] }),
  },
  {
    id: 'suspended',
    label: 'Platform suspended business',
    expectedGateStatus: 403,
    expectedCode: 'BUSINESS_SUSPENDED',
    suspended: true,
    subscription: baseSubscription({ status: 'active' }),
  },
];

export const NO_TOKEN_SCENARIO = {
  id: 'noToken' as const,
  label: 'No JWT / session headers',
  expectedGateStatus: 401,
};
