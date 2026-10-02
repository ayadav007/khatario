/**
 * When the access token has expired, middleware refreshes inline. A rejected refresh must
 * surface as SESSION_REVOKED (clients hard-logout), while an unreachable refresh endpoint
 * is transient and must not look like a revoked session.
 */
jest.mock('@/lib/jwt', () => ({
  shouldRotateTokens: jest.fn(async () => ({
    rotate: true,
    payload: {
      userId: '11111111-1111-4111-8111-111111111111',
      businessId: '22222222-2222-4222-8222-222222222222',
      type: 'refresh',
      sv: 3,
    },
  })),
}));
jest.mock('@/lib/platform-jwt', () => ({ getPlatformSessionFromRequest: jest.fn(async () => null) }));
jest.mock('@/lib/store/subdomain', () => ({ extractStoreSubdomain: () => null }));

import { NextRequest } from 'next/server';
import { middleware } from '../../middleware';

const originalFetch = global.fetch;

function apiRequest(): NextRequest {
  return new NextRequest('https://app.khatario.test/api/subscriptions/current', {
    headers: { host: 'app.khatario.test', cookie: 'khatario_refresh=stale' },
  });
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('middleware inline refresh failure', () => {
  it('returns SESSION_REVOKED when the refresh endpoint rejects the token', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ code: 'SESSION_REVOKED' }), { status: 401 }),
    ) as typeof fetch;

    const res = await middleware(apiRequest());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('SESSION_REVOKED');
  });

  it('returns 503 SESSION_REFRESH_UNAVAILABLE when the refresh endpoint cannot be reached', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;

    const res = await middleware(apiRequest());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('SESSION_REFRESH_UNAVAILABLE');
  });
});
