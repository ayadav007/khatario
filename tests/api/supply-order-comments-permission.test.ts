/**
 * Posting a message on a Supplier Hub order is a write: it needs the update permission on the
 * side's module (purchases for the buyer, invoices for the supplier), like every other order
 * action. Reading the thread stays a read. (QA finding F-011, 2026-10-28.)
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/authorization', () => {
  class AuthorizationError extends Error {
    toNextResponse() {
      const { NextResponse } = jest.requireActual('next/server');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return { authorize: jest.fn(), AuthorizationError };
});
jest.mock('@/lib/stock-request-security', () => ({
  requireAuthenticatedTenant: jest.fn(() => ({ userId: 'staff-1', businessId: 'vendor-biz' })),
}));
const addOrderComment = jest.fn();
const listOrderComments = jest.fn().mockResolvedValue([]);
jest.mock('@/lib/supply-orders', () => ({
  SupplyOrderInputError: class SupplyOrderInputError extends Error {},
  loadOrderForParty: jest.fn().mockResolvedValue({ order: { id: 'order-1' }, role: 'vendor' }),
  addOrderComment: (...a: unknown[]) => addOrderComment(...a),
  listOrderComments: (...a: unknown[]) => listOrderComments(...a),
}));

import { GET, POST } from '@/app/api/supply-orders/[id]/comments/route';
import { authorize, AuthorizationError } from '@/lib/authorization';

const ctx = { params: { id: 'order-1' } };
const post = () =>
  new NextRequest('http://localhost/api/supply-orders/order-1/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'Need these by Friday' }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  addOrderComment.mockResolvedValue({ id: 'c1', body: 'Need these by Friday' });
});

describe('POST /api/supply-orders/[id]/comments', () => {
  it('asks for the update permission on the side’s module', async () => {
    (authorize as jest.Mock).mockResolvedValue(undefined);
    const res = await POST(post(), ctx);
    expect(res.status).toBe(201);
    expect(authorize).toHaveBeenCalledWith('staff-1', 'invoices', 'update', { businessId: 'vendor-biz' });
  });

  it('refuses a read-only user and saves nothing', async () => {
    (authorize as jest.Mock).mockRejectedValue(new (AuthorizationError as any)('no update'));
    const res = await POST(post(), ctx);
    expect(res.status).toBe(403);
    expect(addOrderComment).not.toHaveBeenCalled();
  });
});

describe('GET /api/supply-orders/[id]/comments', () => {
  it('still only needs read', async () => {
    (authorize as jest.Mock).mockResolvedValue(undefined);
    const res = await GET(new NextRequest('http://localhost/api/supply-orders/order-1/comments'), ctx);
    expect(res.status).toBe(200);
    expect(authorize).toHaveBeenCalledWith('staff-1', 'invoices', 'read', { businessId: 'vendor-biz' });
  });
});
