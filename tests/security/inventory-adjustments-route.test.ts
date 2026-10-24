/**
 * POST /api/inventory-adjustments must authorize and record the session user, never a
 * `created_by` / `user_id` sent in the request body.
 */
jest.mock('@/lib/db', () => ({ queryRows: jest.fn(), queryOne: jest.fn() }));
const mockQuantity = jest.fn();
const mockValue = jest.fn();
jest.mock('@/lib/inventory-adjustment-service', () => ({
  createQuantityAdjustment: (...a: unknown[]) => mockQuantity(...a),
  createValueAdjustment: (...a: unknown[]) => mockValue(...a),
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
const mockFeature = jest.fn();
jest.mock('@/lib/subscription/feature-access', () => {
  class FeatureAccessDeniedError extends Error {}
  return { assertFeatureAccess: (...a: unknown[]) => mockFeature(...a), FeatureAccessDeniedError };
});
const mockWarehouseMode = jest.fn();
jest.mock('@/lib/warehouse-mode', () => ({ isWarehouseModeEnabled: (...a: unknown[]) => mockWarehouseMode(...a) }));
const mockWarehouseAccess = jest.fn();
jest.mock('@/lib/warehouse-access', () => ({
  checkUserWarehouseAccess: (...a: unknown[]) => mockWarehouseAccess(...a),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/inventory-adjustments/route';

const USER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const BIZ = '22222222-2222-4222-8222-222222222222';
const ITEM = '55555555-5555-4555-8555-555555555555';
const WAREHOUSE = '66666666-6666-4666-8666-666666666666';

const ADJUSTMENT = {
  adjustment_type: 'QUANTITY',
  adjustment_date: '2026-10-13',
  item_id: ITEM,
  direction: 'INCREASE',
  quantity: 2,
  reason_code: 'STOCK_TAKE',
};

function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/inventory-adjustments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const session = {
  'x-authenticated-user-id': USER,
  'x-authenticated-business-id': BIZ,
  'x-authenticated-session-version': '1',
};

beforeEach(() => {
  const { queryOne } = jest.requireMock('@/lib/db') as { queryOne: jest.Mock };
  queryOne.mockImplementation(async (sql: string) => {
    if (String(sql).includes('auth_session_version')) return { auth_session_version: '1' };
    if (String(sql).includes('FROM items')) return { id: ITEM };
    return null;
  });
  mockQuantity.mockReset().mockResolvedValue({ id: 'adj-1' });
  mockValue.mockReset().mockResolvedValue({ id: 'adj-2' });
  mockAuthorize.mockReset().mockResolvedValue(undefined);
  mockFeature.mockReset().mockResolvedValue(undefined);
  mockWarehouseMode.mockReset().mockResolvedValue(false);
  mockWarehouseAccess.mockReset().mockResolvedValue({ can_create_transactions: true });
});

it('authorizes and records the session user', async () => {
  const res = await POST(post(ADJUSTMENT, session));
  expect(res.status).toBe(201);
  expect(mockAuthorize).toHaveBeenCalledWith(USER, 'items', 'create', { businessId: BIZ });
  expect(mockQuantity).toHaveBeenCalledWith(expect.objectContaining({ businessId: BIZ, createdBy: USER }));
});

it('ignores a created_by or user_id in the body', async () => {
  const res = await POST(post({ ...ADJUSTMENT, created_by: ADMIN, user_id: ADMIN }, session));
  expect(res.status).toBe(201);
  expect(mockAuthorize).toHaveBeenCalledWith(USER, 'items', 'create', { businessId: BIZ });
  expect(mockAuthorize).not.toHaveBeenCalledWith(ADMIN, expect.anything(), expect.anything());
  expect(mockQuantity.mock.calls[0][0].createdBy).toBe(USER);
});

it('cannot borrow another user to pass the permission check', async () => {
  mockAuthorize.mockImplementation(async (userId: string) => {
    if (userId !== ADMIN) throw new (jest.requireMock('@/lib/authorization').AuthorizationError)();
  });
  const res = await POST(post({ ...ADJUSTMENT, created_by: ADMIN }, session));
  expect(res.status).toBe(403);
  expect(mockQuantity).not.toHaveBeenCalled();
});

it('checks warehouse access for the session user, not the body user', async () => {
  mockWarehouseMode.mockResolvedValue(true);
  await POST(post({ ...ADJUSTMENT, location_id: WAREHOUSE, created_by: ADMIN }, session));
  expect(mockWarehouseAccess).toHaveBeenCalledWith(USER, WAREHOUSE);
});

it('records the session user on value adjustments', async () => {
  const res = await POST(
    post(
      { ...ADJUSTMENT, adjustment_type: 'VALUE', direction: undefined, quantity: undefined, value_change: 10, created_by: ADMIN },
      session,
    ),
  );
  expect(res.status).toBe(201);
  expect(mockValue.mock.calls[0][0].createdBy).toBe(USER);
});

it('rejects a request with no session user, even with created_by in the body', async () => {
  const res = await POST(
    post({ ...ADJUSTMENT, created_by: ADMIN }, { 'x-authenticated-business-id': BIZ }),
  );
  expect(res.status).toBe(401);
  expect(mockAuthorize).not.toHaveBeenCalled();
  expect(mockQuantity).not.toHaveBeenCalled();
});
