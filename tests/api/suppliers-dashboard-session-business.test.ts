/**
 * Supplier dashboard and thresholds GETs take the business from the session. supplier_business_id is
 * optional and, when present, must match the session; the SQL always uses the session business.
 */
import { NextRequest } from 'next/server';

const queryRows = jest.fn();
const queryOne = jest.fn();
jest.mock('@/lib/db', () => ({
  queryRows: (...a: unknown[]) => queryRows(...a),
  queryOne: (...a: unknown[]) => queryOne(...a),
  query: jest.fn(),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
  FeatureAccessDeniedError: class extends Error {},
}));

import { GET as dashboard } from '@/app/api/suppliers/dashboard/route';
import { GET as thresholds } from '@/app/api/suppliers/thresholds/route';
import { GET as analytics } from '@/app/api/suppliers/dashboard/analytics/route';

function req(path: string, qs = '') {
  return new NextRequest(`http://localhost${path}${qs}`, {
    headers: { 'x-authenticated-user-id': 'user-1', 'x-authenticated-business-id': 'biz-session' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  queryRows.mockResolvedValue([]);
  queryOne.mockResolvedValue({ count: '0' });
});

describe.each([
  ['dashboard', dashboard, '/api/suppliers/dashboard'],
  ['thresholds', thresholds, '/api/suppliers/thresholds'],
  ['analytics', analytics, '/api/suppliers/dashboard/analytics'],
] as const)('GET %s', (_n, handler, path) => {
  test('no supplier_business_id: uses the session business', async () => {
    const res = await handler(req(path));
    expect(res.status).toBe(200);
    const calls = [...queryRows.mock.calls, ...queryOne.mock.calls];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][1][0]).toBe('biz-session');
  });

  test('matching supplier_business_id still works', async () => {
    const res = await handler(req(path, '?supplier_business_id=biz-session'));
    expect(res.status).toBe(200);
  });

  test('another business is refused with 403 and touches nothing', async () => {
    const res = await handler(req(path, '?supplier_business_id=biz-other'));
    expect(res.status).toBe(403);
    expect(queryRows).not.toHaveBeenCalled();
    expect(queryOne).not.toHaveBeenCalled();
  });
});
