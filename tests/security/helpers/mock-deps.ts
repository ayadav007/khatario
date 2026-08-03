jest.mock('@/lib/subscription', () => {
  const actual = jest.requireActual('@/lib/subscription');
  return {
    ...actual,
    getBusinessSubscription: jest.fn(),
    hasWhatsAppBotAddon: jest.fn(),
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
jest.mock('@/lib/db');
jest.mock('@/lib/authorization', () => ({
  authorize: jest.fn().mockResolvedValue(undefined),
  AuthorizationError: class AuthorizationError extends Error {
    statusCode = 403;
    code = 'FORBIDDEN';
    toNextResponse() {
      const { NextResponse } = require('next/server');
      return NextResponse.json({ error: this.message, code: this.code }, { status: 403 });
    }
  },
}));
jest.mock('@/lib/enforce-access', () => ({
  enforceAccess: jest.fn().mockResolvedValue(undefined),
  enforceAccessErrorResponse: jest.fn().mockReturnValue(null),
}));
jest.mock('@/lib/branch-helpers', () => ({
  resolveBranchId: jest.fn().mockResolvedValue('branch-test-1'),
}));
jest.mock('@/lib/gst/gst-settlement', () => ({
  getOutstandingGst: jest.fn().mockResolvedValue({ total_outstanding: 0 }),
  recordGstPayment: jest.fn().mockResolvedValue({ ok: true }),
}));
jest.mock('@/lib/auth-helpers', () => {
  const actual = jest.requireActual('@/lib/auth-helpers');
  return {
    ...actual,
    assertSessionValidForCookieAuth: jest.fn().mockResolvedValue(undefined),
    requirePortalSession: jest.fn().mockResolvedValue(null),
    requireTenantBusinessId: jest.fn(actual.requireTenantBusinessId),
  };
});

import { getBusinessSubscription, hasWhatsAppBotAddon } from '@/lib/subscription';
import { isBusinessPlatformSuspended } from '@/lib/admin-business-ops';
import { checkTrialExpiry } from '@/lib/subscription/lifecycle';
import { queryRows, queryOne, query, getPool } from '@/lib/db';
import type { SubscriptionScenarioConfig } from '../fixtures/subscription-scenarios';

const { authorize } = require('@/lib/authorization');

const mockGetBusinessSubscription = getBusinessSubscription as jest.MockedFunction<
  typeof getBusinessSubscription
>;
const mockIsSuspended = isBusinessPlatformSuspended as jest.MockedFunction<
  typeof isBusinessPlatformSuspended
>;
const mockCheckTrialExpiry = checkTrialExpiry as jest.MockedFunction<
  typeof checkTrialExpiry
>;
const mockHasWhatsAppBotAddon = hasWhatsAppBotAddon as jest.MockedFunction<
  typeof hasWhatsAppBotAddon
>;
const mockQueryRows = queryRows as jest.MockedFunction<typeof queryRows>;
const mockQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;
const mockQuery = query as jest.MockedFunction<typeof query>;
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;
const mockAuthorize = authorize as jest.Mock;

export function resetSecurityMocks(): void {
  jest.clearAllMocks();

  mockIsSuspended.mockResolvedValue(false);
  mockCheckTrialExpiry.mockResolvedValue({
    isExpired: false,
    isInGracePeriod: false,
    daysRemaining: 30,
    graceEndsAt: null,
  });
  mockAuthorize.mockResolvedValue(undefined);
  mockHasWhatsAppBotAddon.mockResolvedValue(true);
  mockQueryRows.mockResolvedValue([]);
  mockQueryOne.mockResolvedValue(null);
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
  mockGetPool.mockReturnValue({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'row-1' }], rowCount: 1 }),
      release: jest.fn(),
    }),
  } as never);
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

export {
  mockAuthorize,
  mockGetBusinessSubscription,
  mockHasWhatsAppBotAddon,
  mockIsSuspended,
  mockQueryOne,
  mockQueryRows,
};
