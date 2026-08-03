jest.mock('@/lib/subscription', () => {
  const actual = jest.requireActual('@/lib/subscription');
  return {
    ...actual,
    getBusinessSubscription: jest.fn(),
  };
});
jest.mock('@/lib/admin-business-ops', () => {
  const actual = jest.requireActual('@/lib/admin-business-ops');
  return {
    ...actual,
    isBusinessPlatformSuspended: jest.fn(),
  };
});
jest.mock('@/lib/subscription/lifecycle', () => {
  const actual = jest.requireActual('@/lib/subscription/lifecycle');
  return {
    ...actual,
    checkTrialExpiry: jest.fn(),
  };
});

import { getBusinessSubscription } from '@/lib/subscription';
import { isBusinessPlatformSuspended } from '@/lib/admin-business-ops';
import { checkTrialExpiry } from '@/lib/subscription/lifecycle';
import type { SubscriptionScenarioConfig } from '../fixtures/subscription-scenarios';

const mockGetBusinessSubscription = getBusinessSubscription as jest.MockedFunction<
  typeof getBusinessSubscription
>;
const mockIsSuspended = isBusinessPlatformSuspended as jest.MockedFunction<
  typeof isBusinessPlatformSuspended
>;
const mockCheckTrialExpiry = checkTrialExpiry as jest.MockedFunction<
  typeof checkTrialExpiry
>;

export function resetSubscriptionMocks(): void {
  jest.clearAllMocks();
  mockIsSuspended.mockResolvedValue(false);
  mockCheckTrialExpiry.mockResolvedValue({
    isExpired: false,
    isInGracePeriod: false,
    daysRemaining: 30,
    graceEndsAt: null,
  });
}

export function applySubscriptionScenario(
  scenario: SubscriptionScenarioConfig,
): void {
  mockIsSuspended.mockResolvedValue(Boolean(scenario.suspended));
  mockGetBusinessSubscription.mockResolvedValue(scenario.subscription ?? null);

  if (scenario.trialExpiry) {
    mockCheckTrialExpiry.mockResolvedValue(scenario.trialExpiry);
  } else {
    mockCheckTrialExpiry.mockResolvedValue({
      isExpired: false,
      isInGracePeriod: false,
      daysRemaining: 30,
      graceEndsAt: null,
    });
  }
}

export { mockGetBusinessSubscription, mockIsSuspended, mockCheckTrialExpiry };
