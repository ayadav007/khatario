/**
 * R7: client-supplied identity headers must never become trusted request identity, whatever the
 * path looks like. Middleware used to return NextResponse.next() for any path ending in a
 * "static" extension (.png, .js, ...) before stripping x-authenticated-* / x-platform-admin-*,
 * including /api/ paths, so a route whose last segment is free text received forged identity.
 *
 * Each case runs the real middleware, then hands the result to a controlled handler the way
 * Next.js does: if middleware set override headers, the handler sees exactly those; otherwise it
 * sees the incoming request headers unchanged. The handler reads identity with the app's real
 * auth helpers.
 */
const USER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const BIZ_A = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';
const ADMIN = 'adadadad-3333-4333-8333-adadadadadad';

jest.mock('@/lib/jwt', () => ({
  // A real session cookie for user A in business A; anything else is no session.
  shouldRotateTokens: jest.fn(async (req: { cookies: { get(n: string): { value: string } | undefined } }) =>
    req.cookies.get('khatario_session')?.value === 'valid-session-A'
      ? { rotate: false, payload: { userId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', businessId: 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', sv: 7 } }
      : { rotate: false, payload: null },
  ),
}));
jest.mock('@/lib/platform-jwt', () => ({
  getPlatformSessionFromRequest: jest.fn(async (req: { cookies: { get(n: string): { value: string } | undefined } }) =>
    req.cookies.get('khatario_platform_session')?.value === 'valid-admin'
      ? { adminId: 'adadadad-3333-4333-8333-adadadadadad', sv: 3 }
      : null,
  ),
}));
jest.mock('@/lib/store/subdomain', () => ({
  extractStoreSubdomain: (host: string | null) => (host && host.startsWith('shop.') ? 'shop' : null),
}));

import { NextRequest } from 'next/server';
import { middleware } from '../../middleware';
import {
  getAuthenticatedUserId,
  getSessionScopedBusinessId,
  getSessionVersionFromRequest,
} from '@/lib/auth-helpers';

const FORGED = {
  'x-authenticated-user-id': '99999999-9999-4999-8999-999999999999',
  'x-authenticated-business-id': 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  'x-authenticated-session-version': '1',
  'x-platform-admin-id': '88888888-8888-4888-8888-888888888888',
  'x-platform-admin-session-version': '1',
  'x-employee-portal-session': '1',
  'x-khatario-pathname': '/settings',
};

type Outcome =
  | { kind: 'blocked'; status: number }
  | { kind: 'redirect'; status: number }
  | {
      kind: 'handler';
      userId: string | null;
      businessId: string | null;
      sessionVersion: number | null;
      adminId: string | null;
      portal: string | null;
      pathnameHeader: string | null;
    };

/** What the route handler would see after Next.js applies the middleware response. */
async function reachHandler(url: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Outcome> {
  const req = new NextRequest(url, { method, headers: { host: new URL(url).host, ...headers } });
  const res = await middleware(req);
  const passes = res.headers.get('x-middleware-next') === '1' || res.headers.has('x-middleware-rewrite');
  if (!passes) {
    return res.status >= 300 && res.status < 400 ? { kind: 'redirect', status: res.status } : { kind: 'blocked', status: res.status };
  }
  let forwarded: Headers;
  const overridden = res.headers.get('x-middleware-override-headers');
  if (overridden) {
    forwarded = new Headers();
    for (const name of overridden.split(',').filter(Boolean)) {
      const value = res.headers.get(`x-middleware-request-${name}`);
      if (value !== null) forwarded.set(name, value);
    }
  } else {
    forwarded = new Headers(req.headers);
  }
  const handlerReq = new NextRequest(url, { method, headers: forwarded });
  return {
    kind: 'handler',
    userId: getAuthenticatedUserId(handlerReq),
    businessId: getSessionScopedBusinessId(handlerReq),
    sessionVersion: getSessionVersionFromRequest(handlerReq),
    adminId: handlerReq.headers.get('x-platform-admin-id'),
    portal: handlerReq.headers.get('x-employee-portal-session'),
    pathnameHeader: handlerReq.headers.get('x-khatario-pathname'),
  };
}

const APP = 'https://app.khatario.test';
const sessionA = { cookie: 'khatario_session=valid-session-A' };

/** Forged identity, no real session: the handler must never see the forged values. */
function expectNoForgedIdentity(o: Outcome) {
  if (o.kind !== 'handler') return; // blocked or redirected: the forged identity reached nothing
  expect(o.userId).not.toBe(FORGED['x-authenticated-user-id']);
  expect(o.businessId).not.toBe(FORGED['x-authenticated-business-id']);
  expect(o.adminId).not.toBe(FORGED['x-platform-admin-id']);
  expect(o.portal).toBeNull();
  expect(o.pathnameHeader).not.toBe(FORGED['x-khatario-pathname']);
}

describe('API paths ending in a file extension are never static assets', () => {
  const suffixed = [
    '/api/example/file.png',
    '/api/example/file.js',
    '/api/example/file.pdf',
    '/api/example/file.css',
    '/api/example/file.svg',
    '/api/example/file.woff2',
    '/api/a/b/c/deep.webp',
    '/api/whatsapp/media/photo.jpg',
    '/api/hr/reports/x.ico',
  ];

  it.each(suffixed)('%s with forged headers and no session is refused', async (path) => {
    const o = await reachHandler(`${APP}${path}`, FORGED);
    expect(o).toEqual({ kind: 'blocked', status: 401 });
  });

  it.each(suffixed)('%s with a real session for business A sees only A, never forged B', async (path) => {
    const o = await reachHandler(`${APP}${path}`, { ...FORGED, ...sessionA });
    expect(o).toMatchObject({ kind: 'handler', userId: USER_A, businessId: BIZ_A, sessionVersion: 7, adminId: null, portal: null });
    if (o.kind === 'handler') expect(o.pathnameHeader).toBe(path);
  });

  it.each(['/api/admin/marketing/pages/home.png', '/api/admin/videos/file/x.js'])(
    'platform-admin %s with a forged admin id and no admin session is refused',
    async (path) => {
      const o = await reachHandler(`${APP}${path}`, FORGED);
      expect(o).toEqual({ kind: 'blocked', status: 401 });
    },
  );

  it('platform-admin path ending in .png with a real admin session sees only the real admin', async () => {
    const o = await reachHandler(`${APP}/api/admin/marketing/pages/home.png`, {
      ...FORGED,
      cookie: 'khatario_platform_session=valid-admin',
    });
    expect(o).toMatchObject({ kind: 'handler', adminId: ADMIN, userId: null, businessId: null, portal: null });
  });
});

describe('ordinary API paths', () => {
  it('no session, forged headers: refused', async () => {
    expect(await reachHandler(`${APP}/api/example`, FORGED)).toEqual({ kind: 'blocked', status: 401 });
  });

  it('a real session for business A with forged business B headers: handler sees A', async () => {
    const o = await reachHandler(`${APP}/api/invoices`, { ...FORGED, ...sessionA });
    expect(o).toMatchObject({ kind: 'handler', userId: USER_A, businessId: BIZ_A, sessionVersion: 7, adminId: null, portal: null });
  });
});

describe('static files still pass, without identity', () => {
  it.each([
    '/_next/static/chunks/main.js',
    '/images/logo.png',
    '/fonts/inter.woff2',
    '/favicon.ico',
    '/manifest.json',
    '/robots.txt',
    '/theme-demos/heritage/hero.jpg',
    '/sw.js',
  ])('%s passes through and carries no forged identity', async (path) => {
    const o = await reachHandler(`${APP}${path}`, FORGED);
    expect(o.kind).toBe('handler');
    expectNoForgedIdentity(o);
  });
});

describe('public routes', () => {
  it.each(['/api/public/store/shop/items', '/api/public/wa-shop/image/abc.png', '/api/health', '/login', '/blog/post'])(
    '%s passes without forged identity',
    async (path) => {
      const o = await reachHandler(`${APP}${path}`, FORGED);
      expect(o.kind).toBe('handler');
      expectNoForgedIdentity(o);
    },
  );
});

describe('employee portal routes', () => {
  const portalCookie = { cookie: `khatario_employee_portal=${'a'.repeat(64)}` };

  it('an allowlisted ESS API with a portal cookie gets only the portal marker, no forged identity', async () => {
    const o = await reachHandler(`${APP}/api/employees/attendance`, { ...FORGED, ...portalCookie });
    expect(o).toMatchObject({ kind: 'handler', userId: null, businessId: null, adminId: null, portal: '1' });
    if (o.kind === 'handler') expect(o.pathnameHeader).toBeNull();
  });

  it('an allowlisted ESS API ending in an extension is treated the same way', async () => {
    const o = await reachHandler(`${APP}/api/employees/salary/payslips/slip.png`, { ...FORGED, ...portalCookie });
    expect(o).toMatchObject({ kind: 'handler', userId: null, businessId: null, adminId: null, portal: '1' });
  });

  it('the employee-portal pages stay public and carry no forged identity', async () => {
    const o = await reachHandler(`${APP}/attendance/login`, FORGED);
    expect(o.kind).toBe('handler');
    expectNoForgedIdentity(o);
  });
});

describe('store subdomains', () => {
  const SHOP = 'https://shop.khatario.test';

  it('a non-public API ending in .png on a store host is refused', async () => {
    expect(await reachHandler(`${SHOP}/api/whatsapp/media/x.png`, FORGED)).toEqual({ kind: 'blocked', status: 401 });
  });

  it('a public store API on a store host passes without forged identity', async () => {
    const o = await reachHandler(`${SHOP}/api/public/store/shop/items`, FORGED);
    expect(o.kind).toBe('handler');
    expectNoForgedIdentity(o);
  });

  it('a storefront page rewrite carries no forged identity', async () => {
    const o = await reachHandler(`${SHOP}/products/abc`, FORGED);
    expect(o.kind).toBe('handler');
    expectNoForgedIdentity(o);
  });

  it('store review and theme photos pass without forged identity', async () => {
    const o = await reachHandler(`${SHOP}/media/store-theme/biz/hero.webp`, FORGED);
    expect(o.kind).toBe('handler');
    expectNoForgedIdentity(o);
  });
});

describe('protected app pages', () => {
  it('a page ending in an extension with forged headers and no session does not reach a handler', async () => {
    const o = await reachHandler(`${APP}/dashboard/report.png`, FORGED);
    expectNoForgedIdentity(o);
  });
});
