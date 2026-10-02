/**
 * Store subdomains never carry a merchant session. Only public APIs may pass through there;
 * everything else must be refused before handlers that fall back to query/body identity run.
 */
const mockShouldRotateTokens = jest.fn();
jest.mock('@/lib/jwt', () => ({ shouldRotateTokens: (...a: unknown[]) => mockShouldRotateTokens(...a) }));
jest.mock('@/lib/platform-jwt', () => ({ getPlatformSessionFromRequest: jest.fn(async () => null) }));
jest.mock('@/lib/store/subdomain', () => ({
  extractStoreSubdomain: (host: string | null) => (host && host.startsWith('shop.') ? 'shop' : null),
}));

import { NextRequest } from 'next/server';
import { middleware } from '../../middleware';

const USER = '11111111-1111-4111-8111-111111111111';
const BIZ = '22222222-2222-4222-8222-222222222222';
const STORE = 'https://shop.khatario.test';

function storeReq(path: string, init: { method?: string } = {}) {
  return new NextRequest(`${STORE}${path}`, { method: init.method ?? 'GET', headers: { host: 'shop.khatario.test' } });
}

function passedThrough(res: Response): boolean {
  return res.headers.get('x-middleware-next') === '1';
}

describe('store subdomain API lockdown', () => {
  beforeEach(() => {
    mockShouldRotateTokens.mockReset().mockResolvedValue({ rotate: false, payload: null });
  });

  it.each([
    `/api/notifications/stream?business_id=${BIZ}&user_id=${USER}`,
    `/api/notifications?business_id=${BIZ}&user_id=${USER}`,
    `/api/auth/session?user_id=${USER}`,
    '/api/invoices',
    '/api/settings/online-store/coupons',
    '/api/todos/check-reminders',
  ])('refuses %s with 401', async (path) => {
    const res = await middleware(storeReq(path));
    expect(res.status).toBe(401);
    expect(passedThrough(res)).toBe(false);
  });

  it.each([
    ['PATCH', `/api/notifications/33333333-3333-4333-8333-333333333333/read`],
    ['POST', '/api/notifications/mark-all-read'],
    ['POST', '/api/notifications/read-all'],
  ])('refuses %s %s with 401', async (method, path) => {
    const res = await middleware(storeReq(path, { method }));
    expect(res.status).toBe(401);
  });

  it('refuses non-public APIs even when the browser has a valid merchant JWT', async () => {
    mockShouldRotateTokens.mockResolvedValue({ rotate: false, payload: { userId: USER, businessId: BIZ, sv: 1 } });
    const res = await middleware(storeReq('/api/notifications/stream'));
    expect(res.status).toBe(401);
  });

  it.each([
    ['GET', '/api/public/store/shop'],
    ['GET', '/api/public/store/shop/items?limit=12'],
    ['GET', '/api/public/store/shop/items/44444444-4444-4444-8444-444444444444'],
    ['POST', '/api/public/store/shop/otp'],
    ['GET', '/api/public/store/shop/account'],
    ['POST', '/api/public/store/shop/favorites'],
    ['POST', '/api/public/store/shop/ratings'],
    ['POST', '/api/public/store/shop/enquiries'],
    ['POST', '/api/public/store/shop/quote'],
    ['POST', '/api/public/store/shop/orders'],
    ['POST', '/api/payments/webhook'],
    ['GET', '/api/health'],
  ])('lets storefront public API %s %s through', async (method, path) => {
    const res = await middleware(storeReq(path, { method }));
    expect(passedThrough(res)).toBe(true);
  });

  it('still rewrites storefront pages to /store', async () => {
    const res = await middleware(storeReq('/products/abc'));
    expect(res.headers.get('x-middleware-rewrite')).toContain('/store/products/abc');
  });

  it('main app host APIs are unchanged (session still required)', async () => {
    const res = await middleware(
      new NextRequest('https://app.khatario.test/api/notifications', { headers: { host: 'app.khatario.test' } })
    );
    expect(res.status).toBe(401);
  });
});
