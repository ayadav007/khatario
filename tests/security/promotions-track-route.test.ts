/**
 * POST /api/promotions/track must only record interactions for the session business.
 */
const mockQuery = jest.fn();
jest.mock('@/lib/db', () => ({ query: (...a: unknown[]) => mockQuery(...a) }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/promotions/track/route';

const PROMO = '55555555-5555-4555-8555-555555555555';
const BIZ_X = '22222222-2222-4222-8222-222222222222';
const BIZ_Y = '33333333-3333-4333-8333-333333333333';

function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/promotions/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const session = { 'x-authenticated-user-id': '11111111-1111-4111-8111-111111111111', 'x-authenticated-business-id': BIZ_X };

beforeEach(() => mockQuery.mockReset().mockResolvedValue({ rows: [] }));

it.each([
  ['view', 'viewed_at'],
  ['click', 'clicked_at'],
  ['dismiss', 'dismissed_at'],
])('records a %s for the session business', async (action, column) => {
  const res = await POST(post({ promotion_id: PROMO, business_id: BIZ_X, action }, session));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true });
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[0][0]).toContain(column);
  expect(mockQuery.mock.calls[0][1]).toEqual([PROMO, BIZ_X]);
});

it("refuses to record against another business's stats", async () => {
  const res = await POST(post({ promotion_id: PROMO, business_id: BIZ_Y, action: 'click' }, session));
  expect(res.status).toBe(403);
  expect((await res.json()).error).toBe('Business ID does not match your session');
  expect(mockQuery).not.toHaveBeenCalled();
});

it('requires a session business even when a body business_id is sent', async () => {
  const res = await POST(post({ promotion_id: PROMO, business_id: BIZ_X, action: 'view' }));
  expect(res.status).toBe(401);
  expect(mockQuery).not.toHaveBeenCalled();
});

it('keeps the 400s for missing fields and bad actions', async () => {
  const missing = await POST(post({ promotion_id: PROMO, action: 'view' }, session));
  expect(missing.status).toBe(400);
  expect((await missing.json()).error).toBe('promotion_id, business_id, and action are required');
  const bad = await POST(post({ promotion_id: PROMO, business_id: BIZ_X, action: 'like' }, session));
  expect(bad.status).toBe(400);
  expect(mockQuery).not.toHaveBeenCalled();
});

it('does not return database error text when tracking fails', async () => {
  mockQuery.mockRejectedValueOnce(new Error('insert or update on table "promotion_views" violates foreign key'));
  const res = await POST(post({ promotion_id: PROMO, business_id: BIZ_X, action: 'view' }, session));
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'Failed to track interaction' });
});
