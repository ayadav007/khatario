/** A used-up plan limit must say which limit it is, so the upgrade popup can name it. */
const mockCheckLimit = jest.fn();
jest.mock('@/lib/subscription', () => ({
  checkLimit: (...a: unknown[]) => mockCheckLimit(...a),
  checkLimitInTransaction: jest.fn(),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  assertFeatureAccess: jest.fn(),
  assertModuleAccess: jest.fn().mockResolvedValue(undefined),
  FeatureAccessDeniedError: class extends Error {},
}));
jest.mock('@/lib/subscription/module-entitlements', () => ({ getLimitOwnerModule: () => 'billing' }));
jest.mock('@/lib/subscription/module-subscriptions', () => ({ getOperationalModuleSubscriptions: jest.fn() }));
jest.mock('@/lib/branch-access', () => ({ checkUserBranchPermission: jest.fn() }));
jest.mock('@/lib/db', () => ({ queryOne: jest.fn() }));
jest.mock('@/lib/auth-helpers', () => ({ assertSessionValidForCookieAuth: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/authorization', () => ({ AuthorizationError: class extends Error {} }));

import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';

it('names the limit in the 403 reply', async () => {
  mockCheckLimit.mockResolvedValue({ allowed: false, limit: 20, current: 20, message: 'Limit reached' });
  let caught: unknown;
  try {
    await enforceAccess({ businessId: 'b', userId: 'u', limitType: 'estimates' });
  } catch (e) {
    caught = e;
  }
  const res = enforceAccessErrorResponse(caught);
  expect(res?.status).toBe(403);
  expect(await res!.json()).toMatchObject({
    code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
    limit_type: 'estimates',
    limit: 20,
    current: 20,
  });
});
