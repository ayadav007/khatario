/**
 * authorize(): the primary-admin short-circuit must not skip the tenant boundary.
 * An owner of business A passing businessId = B (e.g. a row loaded by id) is denied
 * unless user_businesses links them to B.
 */
jest.mock('@/lib/db', () => ({ queryOne: jest.fn() }));
jest.mock('@/lib/auth-helpers', () => ({ assertSessionValidForCookieAuth: jest.fn(async () => undefined) }));
jest.mock('@/lib/subscription/feature-access', () => ({
  assertFeatureAccess: jest.fn(async () => undefined),
  assertModuleAccess: jest.fn(async () => undefined),
  FeatureAccessDeniedError: class extends Error {},
}));
jest.mock('@/lib/permissions', () => ({ checkUserPermissionWithAliases: jest.fn(async () => true) }));
jest.mock('@/lib/branch-access', () => ({ checkUserBranchPermission: jest.fn(async () => true) }));
jest.mock('@/lib/warehouse-access', () => ({ checkUserWarehousePermission: jest.fn(async () => true) }));
jest.mock('@/lib/policies/engine', () => ({ evaluatePolicy: jest.fn(async () => ({ allowed: true })) }));
jest.mock('@/lib/policies/registry', () => ({ getPolicyRegistry: () => ({ getPolicies: () => [] }) }));
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));

import { authorize, AuthorizationError } from '@/lib/authorization';

const { queryOne } = require('@/lib/db') as { queryOne: jest.Mock };

function mockDb(opts: { memberOf?: string[] }) {
  queryOne.mockImplementation(async (sql: string, params: unknown[]) => {
    if (/SELECT is_primary_admin, business_id FROM users/.test(sql)) {
      return { is_primary_admin: true, business_id: 'biz-A' };
    }
    if (/FROM user_businesses/.test(sql)) {
      return (opts.memberOf ?? []).includes(String(params[1])) ? { one: 1 } : null;
    }
    return null;
  });
}

describe('authorize — tenant boundary for primary admin', () => {
  beforeEach(() => queryOne.mockReset());

  it('owner acting on own business is allowed', async () => {
    mockDb({});
    await expect(authorize('owner-A', 'invoices', 'create', { businessId: 'biz-A' })).resolves.toBeUndefined();
  });

  it('owner acting on another business is denied (CROSS_TENANT_DENIED)', async () => {
    mockDb({});
    await expect(authorize('owner-A', 'warehouse_transfer', 'approve', { businessId: 'biz-B' })).rejects.toMatchObject({
      code: 'CROSS_TENANT_DENIED',
      statusCode: 403,
    });
  });

  it('owner linked to the other business via user_businesses is allowed', async () => {
    mockDb({ memberOf: ['biz-B'] });
    await expect(authorize('owner-A', 'invoices', 'create', { businessId: 'biz-B' })).resolves.toBeUndefined();
  });

  it('no businessId in context keeps previous behaviour', async () => {
    mockDb({});
    await expect(authorize('owner-A', 'invoices', 'read')).resolves.toBeUndefined();
  });

  it('error is an AuthorizationError', async () => {
    mockDb({});
    await expect(authorize('owner-A', 'invoices', 'create', { businessId: 'biz-B' })).rejects.toBeInstanceOf(AuthorizationError);
  });
});
