jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  setSessionCookies: jest.fn(),
  signAccessToken: jest.fn(),
  signRefreshToken: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  queryOne: jest.fn(),
  getPool: jest.fn(),
}));

jest.mock('@/lib/auth-helpers', () => ({
  assertUserSessionVersionMatches: jest.fn(),
  getSessionVersionFromRequest: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/businesses/route';
import { queryOne } from '@/lib/db';
import { assertUserSessionVersionMatches } from '@/lib/auth-helpers';

const queryOneMock = queryOne as jest.Mock;
const sessionMock = assertUserSessionVersionMatches as jest.Mock;

function request(body: unknown, userId?: string) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (userId) headers.set('x-authenticated-user-id', userId);
  return new NextRequest('http://localhost:3000/api/businesses', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/businesses', () => {
  beforeEach(() => {
    queryOneMock.mockReset();
    sessionMock.mockReset();
  });

  it('does not treat a body user id as the logged-in owner', async () => {
    const res = await POST(
      request({
        user_id: '11111111-1111-4111-8111-111111111111',
        businessName: 'Second Shop',
        businessType: 'retail',
        industry: 'other',
      }),
    );
    expect(res.status).toBe(401);
    expect(queryOneMock).not.toHaveBeenCalled();
  });

  it('refuses staff who are not the primary admin', async () => {
    sessionMock.mockResolvedValue({ ok: true });
    queryOneMock.mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      is_primary_admin: false,
      business_id: '33333333-3333-4333-8333-333333333333',
      product_line: 'billing',
    });
    const res = await POST(
      request(
        { businessName: 'Second Shop', businessType: 'retail', industry: 'other' },
        '22222222-2222-4222-8222-222222222222',
      ),
    );
    expect(res.status).toBe(403);
  });
});
