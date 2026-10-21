/**
 * POST /api/customers must authorize the session user, never a `created_by` / `user_id`
 * sent in the request body.
 */
const mockClientQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  query: jest.fn(),
  queryRows: jest.fn(),
  queryOne: jest.fn().mockResolvedValue(null),
  getPool: () => ({ connect: async () => ({ query: mockClientQuery, release: jest.fn() }) }),
}));
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
const mockEnforce = jest.fn();
jest.mock('@/lib/enforce-access', () => ({
  enforceAccess: (...a: unknown[]) => mockEnforce(...a),
  enforceAccessErrorResponse: () => null,
  isPrimaryAdminForBusiness: jest.fn(),
}));
const mockBoundary = jest.fn();
jest.mock('@/lib/access-boundary', () => ({
  checkEmployeeAccessBoundary: (...a: unknown[]) => mockBoundary(...a),
}));
jest.mock('@/lib/security/require-platform-module', () => ({
  requirePlatformModule: jest.fn(),
  platformModuleErrorResponse: () => null,
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/customers/route';

const USER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const BIZ = '22222222-2222-4222-8222-222222222222';

const session = {
  'x-authenticated-user-id': USER,
  'x-authenticated-business-id': BIZ,
  'x-authenticated-session-version': '1',
};

function post(body: Record<string, unknown>, headers: Record<string, string> = session) {
  return POST(
    new NextRequest('http://localhost/api/customers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  const { queryOne } = jest.requireMock('@/lib/db') as { queryOne: jest.Mock };
  queryOne.mockImplementation(async (sql: string) =>
    String(sql).includes('auth_session_version') ? { auth_session_version: '1' } : null,
  );
  mockClientQuery.mockReset().mockImplementation(async (sql: string) =>
    sql.includes('INSERT INTO customers') ? { rows: [{ id: 'cust-1', name: 'Ravi' }] } : { rows: [] },
  );
  mockAuthorize.mockReset().mockResolvedValue(undefined);
  mockEnforce.mockReset().mockResolvedValue(undefined);
  mockBoundary.mockReset().mockResolvedValue({ allowed: true });
});

it('authorizes the session user', async () => {
  const res = await post({ name: 'Ravi' });
  expect(res.status).toBe(201);
  expect(mockAuthorize).toHaveBeenCalledWith(USER, 'customers', 'create', { businessId: BIZ });
  expect(mockBoundary).toHaveBeenCalledWith(USER, 'portal');
  expect(mockEnforce).toHaveBeenCalledWith(expect.objectContaining({ businessId: BIZ, userId: USER }));
});

it('ignores a created_by or user_id in the body', async () => {
  const res = await post({ name: 'Ravi', created_by: ADMIN, user_id: ADMIN });
  expect(res.status).toBe(201);
  expect(mockAuthorize).toHaveBeenCalledWith(USER, 'customers', 'create', { businessId: BIZ });
  expect(mockAuthorize).not.toHaveBeenCalledWith(ADMIN, expect.anything(), expect.anything());
  expect(mockBoundary).toHaveBeenCalledWith(USER, 'portal');
  expect(mockEnforce.mock.calls[0][0].userId).toBe(USER);
});

it('cannot borrow another user to pass the permission check', async () => {
  mockAuthorize.mockImplementation(async (userId: string) => {
    if (userId !== ADMIN) throw new (jest.requireMock('@/lib/authorization').AuthorizationError)();
  });
  const res = await post({ name: 'Ravi', created_by: ADMIN });
  expect(res.status).toBe(403);
  expect(mockClientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT'))).toBe(false);
});

it('rejects a request that has no session user, even with created_by in the body', async () => {
  const res = await post({ name: 'Ravi', created_by: ADMIN }, { 'x-authenticated-business-id': BIZ });
  expect(res.status).toBe(401);
  expect(mockAuthorize).not.toHaveBeenCalled();
  expect(mockClientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT'))).toBe(false);
});
