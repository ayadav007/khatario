/**
 * /api/dashboard/widgets must only read and save the layout of the session business, and the acting
 * user must come from the session (never from the request body or query string).
 */
const mockQuery = jest.fn();
const mockQueryRows = jest.fn();
jest.mock('@/lib/db', () => ({
  db: { query: (...a: unknown[]) => mockQuery(...a), queryRows: (...a: unknown[]) => mockQueryRows(...a) },
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

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/dashboard/widgets/route';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '44444444-4444-4444-8444-444444444444';
const BIZ_X = '22222222-2222-4222-8222-222222222222';
const BIZ_Y = '33333333-3333-4333-8333-333333333333';
const WIDGETS = [{ id: 'w1', type: 'top_customers', title: 'Top Customers', position: { x: 0, y: 0 }, size: { width: 1, height: 1 } }];

function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/dashboard/widgets', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const session = { 'x-authenticated-user-id': USER, 'x-authenticated-business-id': BIZ_X };

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [] });
  mockQueryRows.mockReset().mockResolvedValue([]);
  mockAuthorize.mockReset().mockResolvedValue(undefined);
  mockFeature.mockReset().mockResolvedValue(undefined);
});

it('saves the layout of the session business', async () => {
  const res = await POST(post({ business_id: BIZ_X, widgets: WIDGETS }, session));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true });
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[0][1]).toEqual([BIZ_X, JSON.stringify(WIDGETS)]);
  expect(mockAuthorize).toHaveBeenCalledWith(USER, 'dashboard', 'read');
});

it("refuses to overwrite another business's layout", async () => {
  const res = await POST(post({ business_id: BIZ_Y, widgets: WIDGETS }, session));
  expect(res.status).toBe(403);
  expect((await res.json()).error).toBe('Business ID does not match your session');
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockFeature).not.toHaveBeenCalled();
});

it('does not take the acting user from the body', async () => {
  const res = await POST(post({ business_id: BIZ_X, widgets: WIDGETS, user_id: OTHER_USER, created_by: OTHER_USER }));
  expect(res.status).toBe(401);
  expect(mockAuthorize).not.toHaveBeenCalled();
  expect(mockQuery).not.toHaveBeenCalled();
});

it('requires a session business even when a body business_id is sent', async () => {
  const res = await POST(post({ business_id: BIZ_X, widgets: WIDGETS }, { 'x-authenticated-user-id': USER }));
  expect(res.status).toBe(401);
  expect(mockQuery).not.toHaveBeenCalled();
});

it('keeps the 400 for missing fields', async () => {
  const res = await POST(post({ business_id: BIZ_X }, session));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe('Missing fields');
});

it('does not return database error text when saving fails', async () => {
  mockQuery.mockRejectedValueOnce(new Error('relation "dashboard_layouts" does not exist'));
  const res = await POST(post({ business_id: BIZ_X, widgets: WIDGETS }, session));
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'Failed to save widgets' });
});

describe('GET', () => {
  function get(query: string, headers: Record<string, string> = {}) {
    return new NextRequest(`http://localhost/api/dashboard/widgets${query}`, { headers });
  }

  it('loads the layout of the session business', async () => {
    mockQueryRows.mockResolvedValueOnce([{ widgets: WIDGETS }]);
    const res = await GET(get(`?business_id=${BIZ_X}`, session));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ widgets: WIDGETS });
    expect(mockQueryRows.mock.calls[0][1]).toEqual([BIZ_X]);
    expect(mockAuthorize).toHaveBeenCalledWith(USER, 'dashboard', 'read');
  });

  it('uses the session business when no business_id is sent', async () => {
    const res = await GET(get('', session));
    expect(res.status).toBe(200);
    expect(mockQueryRows.mock.calls[0][1]).toEqual([BIZ_X]);
  });

  it("refuses to read another business's layout", async () => {
    const res = await GET(get(`?business_id=${BIZ_Y}`, session));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Business ID does not match your session');
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it('does not take the user or business from the query string', async () => {
    const res = await GET(get(`?business_id=${BIZ_Y}&user_id=${OTHER_USER}`));
    expect(res.status).toBe(401);
    expect(mockAuthorize).not.toHaveBeenCalled();
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it('requires a session business', async () => {
    const res = await GET(get(`?business_id=${BIZ_X}`, { 'x-authenticated-user-id': USER }));
    expect(res.status).toBe(401);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it('does not return database error text when loading fails', async () => {
    mockQueryRows.mockRejectedValueOnce(new Error('relation "dashboard_layouts" does not exist'));
    const res = await GET(get('', session));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to load widgets' });
  });
});
