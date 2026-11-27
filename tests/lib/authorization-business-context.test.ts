/**
 * authorize(): plan gates (module gate, plan path gate, HR feature gate) are judged on the business of the
 * session (trusted header x-authenticated-business-id), not on the stored pointer users.business_id.
 * Order: explicit context.businessId, then the session header, then users.business_id.
 */
jest.mock('@/lib/db', () => ({ queryOne: jest.fn() }));
jest.mock('@/lib/auth-helpers', () => ({ assertSessionValidForCookieAuth: jest.fn(async () => undefined) }));
jest.mock('@/lib/subscription/feature-access', () => ({
  assertFeatureAccess: jest.fn(async () => undefined),
  assertModuleAccess: jest.fn(async () => undefined),
  FeatureAccessDeniedError: class extends Error {},
  SupplierHubHiddenError: class extends Error {},
}));
jest.mock('@/lib/permissions', () => ({ checkUserPermissionWithAliases: jest.fn(async () => true) }));
jest.mock('@/lib/branch-access', () => ({ checkUserBranchPermission: jest.fn(async () => true) }));
jest.mock('@/lib/warehouse-access', () => ({ checkUserWarehousePermission: jest.fn(async () => true) }));
jest.mock('@/lib/policies/engine', () => ({ evaluatePolicy: jest.fn(async () => ({ allowed: true })) }));
jest.mock('@/lib/policies/registry', () => ({ getPolicyRegistry: () => ({ getPolicies: () => [] }) }));
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));

// null = outside a request (next/headers throws there); otherwise the request headers.
const requestHeaders: { current: Record<string, string> | null } = { current: null };
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => {
    if (!requestHeaders.current) throw new Error('`headers` was called outside a request scope');
    return { get: (name: string) => requestHeaders.current![name.toLowerCase()] ?? null };
  }),
}));

import { authorize } from '@/lib/authorization';

const { queryOne } = require('@/lib/db') as { queryOne: jest.Mock };
const { assertFeatureAccess, assertModuleAccess } = require('@/lib/subscription/feature-access') as {
  assertFeatureAccess: jest.Mock;
  assertModuleAccess: jest.Mock;
};

function mockDb(opts: { stored: string; memberOf?: string[] }) {
  queryOne.mockImplementation(async (sql: string, params: unknown[]) => {
    if (/SELECT is_primary_admin, business_id FROM users/.test(sql)) {
      return { is_primary_admin: true, business_id: opts.stored };
    }
    if (/FROM user_businesses/.test(sql)) {
      return (opts.memberOf ?? []).includes(String(params[1])) ? { one: 1 } : null;
    }
    return null;
  });
}

describe('authorize: business used for plan checks', () => {
  beforeEach(() => {
    queryOne.mockReset();
    assertFeatureAccess.mockClear();
    assertModuleAccess.mockClear();
    requestHeaders.current = null;
  });

  it('judges the module gate and the path gate on the session business, not the stored pointer', async () => {
    mockDb({ stored: 'biz-PAID', memberOf: ['biz-FREE'] });
    requestHeaders.current = { 'x-authenticated-business-id': 'biz-FREE', 'x-khatario-pathname': '/api/ledger' };
    await authorize('owner', 'reports', 'read');
    expect(assertModuleAccess).toHaveBeenCalledWith('biz-FREE', 'billing', 'reports');
    expect(assertFeatureAccess).toHaveBeenCalledWith('biz-FREE', 'advanced_ledger');
  });

  it('judges the HR feature gate on the session business', async () => {
    mockDb({ stored: 'biz-PAID', memberOf: ['biz-FREE'] });
    requestHeaders.current = { 'x-authenticated-business-id': 'biz-FREE' };
    await authorize('owner', 'employees', 'read');
    expect(assertFeatureAccess).toHaveBeenCalledWith('biz-FREE', 'hr_employees');
  });

  it('runs the membership query at most once per authorize call when the session business differs from the pointer', async () => {
    mockDb({ stored: 'biz-PAID', memberOf: ['biz-FREE'] });
    requestHeaders.current = { 'x-authenticated-business-id': 'biz-FREE', 'x-khatario-pathname': '/api/ledger' };
    // 'employees' hits the module gate, the path gate and the HR feature gate: three resolver callers.
    await authorize('owner', 'employees', 'read');
    const membershipCalls = queryOne.mock.calls.filter(([sql]) => /FROM user_businesses/.test(sql as string));
    expect(membershipCalls).toHaveLength(1);
    expect(assertFeatureAccess).toHaveBeenCalledWith('biz-FREE', 'hr_employees');
  });

  it('an explicit context.businessId wins over the session header', async () => {
    mockDb({ stored: 'biz-A', memberOf: ['biz-B', 'biz-C'] });
    requestHeaders.current = { 'x-authenticated-business-id': 'biz-C', 'x-khatario-pathname': '/api/ledger' };
    await authorize('owner', 'reports', 'read', { businessId: 'biz-B' });
    expect(assertModuleAccess).toHaveBeenCalledWith('biz-B', 'billing', 'reports');
    expect(assertFeatureAccess).toHaveBeenCalledWith('biz-B', 'advanced_ledger');
  });

  it('a session business the user is not a member of is denied (CROSS_TENANT_DENIED)', async () => {
    mockDb({ stored: 'biz-A', memberOf: [] });
    requestHeaders.current = { 'x-authenticated-business-id': 'biz-X' };
    await expect(authorize('owner', 'reports', 'read')).rejects.toMatchObject({
      code: 'CROSS_TENANT_DENIED',
      statusCode: 403,
    });
    expect(assertModuleAccess).not.toHaveBeenCalled();
  });

  it('a session business equal to the stored pointer needs no membership lookup', async () => {
    mockDb({ stored: 'biz-A', memberOf: [] });
    requestHeaders.current = { 'x-authenticated-business-id': 'biz-A' };
    await authorize('owner', 'reports', 'read');
    expect(assertModuleAccess).toHaveBeenCalledWith('biz-A', 'billing', 'reports');
    expect(queryOne.mock.calls.some(([sql]) => /user_businesses/.test(sql))).toBe(false);
  });

  it('outside a request (cron) the stored pointer is used', async () => {
    mockDb({ stored: 'biz-A' });
    requestHeaders.current = null;
    await authorize('owner', 'reports', 'read');
    expect(assertModuleAccess).toHaveBeenCalledWith('biz-A', 'billing', 'reports');
  });

  it('a request without the session header falls back to the stored pointer', async () => {
    mockDb({ stored: 'biz-A' });
    requestHeaders.current = { 'x-khatario-pathname': '/api/ledger' };
    await authorize('owner', 'reports', 'read');
    expect(assertFeatureAccess).toHaveBeenCalledWith('biz-A', 'advanced_ledger');
  });
});
