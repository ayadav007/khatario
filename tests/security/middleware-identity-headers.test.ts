/**
 * Client-supplied x-authenticated-* headers must never reach route handlers on
 * passthrough paths (store subdomain APIs, public APIs).
 */
jest.mock('@/lib/jwt', () => ({ shouldRotateTokens: jest.fn(async () => ({ rotate: false, payload: null })) }));
jest.mock('@/lib/platform-jwt', () => ({ getPlatformSessionFromRequest: jest.fn(async () => null) }));
jest.mock('@/lib/store/subdomain', () => ({
  extractStoreSubdomain: (host: string | null) => (host && host.startsWith('shop.') ? 'shop' : null),
}));

import { NextRequest } from 'next/server';
import { middleware } from '../../middleware';

function forwardedHeader(res: Response, name: string): string | null {
  // NextResponse.next({ request: { headers } }) encodes overridden request headers.
  const overridden = res.headers.get('x-middleware-override-headers');
  if (!overridden) return 'NOT_OVERRIDDEN';
  if (!overridden.split(',').includes(name)) return null;
  return res.headers.get(`x-middleware-request-${name}`);
}

const spoof = {
  'x-authenticated-user-id': '11111111-1111-4111-8111-111111111111',
  'x-authenticated-business-id': '22222222-2222-4222-8222-222222222222',
  'x-authenticated-session-version': '1',
};

describe('middleware strips spoofed identity headers', () => {
  it('store subdomain public /api/* passthrough', async () => {
    const req = new NextRequest('https://shop.khatario.test/api/public/store/shop/items', { headers: { host: 'shop.khatario.test', ...spoof } });
    const res = await middleware(req);
    expect(forwardedHeader(res, 'x-authenticated-user-id')).toBeNull();
    expect(forwardedHeader(res, 'x-authenticated-business-id')).toBeNull();
  });

  it('store subdomain non-public /api/* is rejected even with spoofed headers', async () => {
    const req = new NextRequest('https://shop.khatario.test/api/invoices', { headers: { host: 'shop.khatario.test', ...spoof } });
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it('public API passthrough', async () => {
    const req = new NextRequest('https://app.khatario.test/api/public/store/x', { headers: { host: 'app.khatario.test', ...spoof } });
    const res = await middleware(req);
    expect(forwardedHeader(res, 'x-authenticated-user-id')).toBeNull();
  });

  it('unauthenticated protected API is rejected', async () => {
    const req = new NextRequest('https://app.khatario.test/api/invoices', { headers: { host: 'app.khatario.test', ...spoof } });
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });
});
