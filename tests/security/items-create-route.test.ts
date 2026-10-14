/**
 * POST /api/items must authorize the session user, never a `created_by` sent in the body.
 */
const mockClientQuery = jest.fn(async (sql: string) =>
  String(sql).includes('INSERT INTO items') ? { rows: [{ id: 'item-1', name: 'Rice' }] } : { rows: [] },
);
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
const mockBoundary = jest.fn();
jest.mock('@/lib/access-boundary', () => ({
  checkEmployeeAccessBoundary: (...a: unknown[]) => mockBoundary(...a),
}));
jest.mock('@/lib/rag/tenant-reindex', () => ({ noteShopChanged: jest.fn() }));
jest.mock('@/lib/inventory/opening-stock-ledger', () => ({ syncItemOpeningStockLedger: jest.fn() }));
jest.mock('@/lib/seed-opening-stock-layers', () => ({ seedOpeningStockLayers: jest.fn() }));
jest.mock('@/lib/subscription', () => ({
  checkLimitInTransaction: jest.fn().mockResolvedValue({ allowed: true }),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/items/route';

const USER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const BIZ = '22222222-2222-4222-8222-222222222222';

function post(body: Record<string, unknown>, headers: Record<string, string> = {
  'x-authenticated-user-id': USER,
  'x-authenticated-business-id': BIZ,
}) {
  return POST(
    new NextRequest('http://localhost/api/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  mockAuthorize.mockReset().mockResolvedValue(undefined);
  mockBoundary.mockReset().mockResolvedValue({ allowed: true });
});

it('authorizes the session user and ignores created_by in the body', async () => {
  const res = await post({ name: 'Rice', created_by: ADMIN, item_type: 'goods', selling_price: 10 });
  expect(res.status).toBe(201);
  expect(mockAuthorize).toHaveBeenCalledWith(USER, 'items', 'create');
  expect(mockAuthorize).not.toHaveBeenCalledWith(ADMIN, expect.anything(), expect.anything());
  expect(mockBoundary).toHaveBeenCalledWith(USER, 'portal');
});

it('does not accept a body created_by when there is no session user', async () => {
  const res = await post({ name: 'Rice', created_by: ADMIN }, { 'x-authenticated-business-id': BIZ });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe('created_by (user_id) is required for authorization');
  expect(mockAuthorize).not.toHaveBeenCalled();
});
