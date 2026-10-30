/**
 * PATCH /api/branches/[id] authorizes the session user. A body
 * updated_by_user_id or business_id cannot choose the actor or the company.
 */
const mockPoolQuery = jest.fn();
jest.mock('@/lib/db', () => ({ queryOne: jest.fn(), query: jest.fn(), getPool: () => ({ query: mockPoolQuery }) }));
const mockAuthorize = jest.fn();
jest.mock('@/lib/authorization', () => {
  class AuthorizationError extends Error {
    toNextResponse() {
      const { NextResponse } = jest.requireActual('next/server');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return { authorize: (...a: unknown[]) => mockAuthorize(...a), AuthorizationError };
});
const mockBranchPermission = jest.fn();
jest.mock('@/lib/branch-access', () => ({
  checkUserBranchPermission: (...a: unknown[]) => mockBranchPermission(...a),
}));
const mockFeature = jest.fn();
jest.mock('@/lib/subscription/feature-access', () => {
  class FeatureAccessDeniedError extends Error {}
  return { assertFeatureAccess: (...a: unknown[]) => mockFeature(...a), FeatureAccessDeniedError };
});

import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/branches/[id]/route';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '44444444-4444-4444-8444-444444444444';
const BIZ = '22222222-2222-4222-8222-222222222222';
const OTHER_BIZ = '33333333-3333-4333-8333-333333333333';
const BRANCH = '55555555-5555-4555-8555-555555555555';

function patch(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/branches/${BRANCH}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const session = {
  'x-authenticated-user-id': USER,
  'x-authenticated-business-id': BIZ,
};

const context = { params: { id: BRANCH } };

beforeEach(() => {
  const { queryOne } = jest.requireMock('@/lib/db') as { queryOne: jest.Mock };
  queryOne.mockReset().mockImplementation(async (sql: string) => {
    const text = String(sql);
    if (text.includes('SELECT is_default')) return { is_default: true, gstin: null, state: 'Gujarat', state_code: '24' };
    if (text.includes('COUNT(*)')) return { n: '1' };
    if (text.includes('UPDATE branches SET')) return { id: BRANCH, name: 'Main', business_id: BIZ };
    return null;
  });
  // Head office registered in Gujarat.
  mockPoolQuery.mockReset().mockResolvedValue({
    rows: [{ b_gstin: '24AAPFU0939F1Z1', b_state: 'Gujarat', b_state_code: '24' }],
  });
  mockAuthorize.mockReset().mockResolvedValue(undefined);
  mockBranchPermission.mockReset().mockResolvedValue(true);
  mockFeature.mockReset().mockResolvedValue(undefined);
});

it('rejects a save that only sends updated_by_user_id', async () => {
  const res = await PATCH(patch({ name: 'Main', updated_by_user_id: USER, business_id: BIZ }), context);
  expect(res.status).toBe(401);
  const body = await res.json();
  expect(body.code).toBe('UNAUTHENTICATED');
  const { queryOne } = jest.requireMock('@/lib/db') as { queryOne: jest.Mock };
  expect(queryOne).not.toHaveBeenCalled();
});

it('saves with the session user and ignores a body user and business', async () => {
  const res = await PATCH(
    patch({ name: 'Main outlet', business_id: OTHER_BIZ, updated_by_user_id: OTHER }, session),
    context,
  );
  expect(res.status).toBe(200);
  expect(mockBranchPermission).toHaveBeenCalledWith(USER, BRANCH, 'edit');
  expect(mockAuthorize).not.toHaveBeenCalled();
  const { queryOne } = jest.requireMock('@/lib/db') as { queryOne: jest.Mock };
  const updateCall = queryOne.mock.calls.find((call) => String(call[0]).includes('UPDATE branches SET'));
  expect(updateCall?.[1][0]).toBe(BRANCH);
  expect(updateCall?.[1][1]).toBe(BIZ);
  expect(updateCall?.[1]).not.toContain(OTHER_BIZ);
});

it('does not let another user id pass the permission check', async () => {
  mockBranchPermission.mockResolvedValue(false);
  mockAuthorize.mockImplementation(async (userId: string) => {
    if (userId !== OTHER) throw new (jest.requireMock('@/lib/authorization').AuthorizationError)();
  });
  const res = await PATCH(
    patch({ name: 'Main', updated_by_user_id: OTHER }, session),
    context,
  );
  expect(res.status).toBe(403);
  expect(mockAuthorize).toHaveBeenCalledWith(USER, 'settings', 'update', {
    businessId: BIZ,
    resourceId: BRANCH,
  });
  const { queryOne } = jest.requireMock('@/lib/db') as { queryOne: jest.Mock };
  const updateCall = queryOne.mock.calls.find((call) => String(call[0]).includes('UPDATE branches SET'));
  expect(updateCall).toBeUndefined();
});

it('refuses to move a branch without its own GSTIN to another state', async () => {
  const res = await PATCH(patch({ state: 'Maharashtra', state_code: '27' }, session), context);
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe('BRANCH_NEEDS_STATE_GSTIN');
  const { queryOne } = jest.requireMock('@/lib/db') as { queryOne: jest.Mock };
  expect(queryOne.mock.calls.find((call) => String(call[0]).includes('UPDATE branches SET'))).toBeUndefined();
});

it('saves a same-state branch under the head-office GSTIN', async () => {
  const res = await PATCH(patch({ state: 'Gujarat', state_code: '24' }, session), context);
  expect(res.status).toBe(200);
});
