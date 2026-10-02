import { NextRequest, NextResponse } from 'next/server';
import { shouldRotateTokens } from './lib/jwt';
import { getPlatformSessionFromRequest } from './lib/platform-jwt';
import { LOCAL_SESSION_COOKIE } from './lib/auth/local-session-cookie';
import {
  isPublicBusinessEmployeePath,
  isEssApiAllowed,
  EMPLOYEE_PORTAL_SESSION_HEADER,
  EMPLOYEE_PORTAL_COOKIE,
} from './lib/employee-portal';
import { extractStoreSubdomain } from './lib/store/subdomain';
import { resolvePublicRequestOrigin } from './lib/http/public-request-origin';

function redirectToBrowserLogin(request: NextRequest, loginPath: string, redirectPath: string) {
  const origin = resolvePublicRequestOrigin(request).replace(/\/$/, '');
  const dest = new URL(loginPath, `${origin}/`);
  dest.searchParams.set('redirect', redirectPath);
  // Must stay an absolute URL. Overwriting Location with a relative path makes
  // Next.js middleware throw (500 on /admin, /dashboard, etc. for guests).
  return NextResponse.redirect(dest);
}

function forwardSetCookies(from: Response, to: NextResponse): void {
  const list = from.headers.getSetCookie?.() ?? [];
  if (list.length > 0) {
    for (const c of list) {
      to.headers.append('Set-Cookie', c);
    }
    return;
  }
  const single = from.headers.get('set-cookie');
  if (single) {
    to.headers.append('Set-Cookie', single);
  }
}

/**
 * Headers that route handlers treat as proof of authentication. Only this
 * middleware may set them; any client-supplied copy must be dropped before the
 * request reaches a handler (store subdomains, public paths, offline shells).
 */
const TRUSTED_IDENTITY_HEADERS = [
  'x-authenticated-user-id',
  'x-authenticated-business-id',
  'x-authenticated-session-version',
  'x-platform-admin-id',
  'x-platform-admin-session-version',
  'x-offline-catalog-session',
  EMPLOYEE_PORTAL_SESSION_HEADER,
];

function sanitizedRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  for (const h of TRUSTED_IDENTITY_HEADERS) headers.delete(h);
  return headers;
}

function hasSpoofedIdentityHeader(request: NextRequest): boolean {
  return TRUSTED_IDENTITY_HEADERS.some((h) => request.headers.has(h));
}

function nextWithoutSpoofedIdentity(request: NextRequest): NextResponse {
  if (!hasSpoofedIdentityHeader(request)) return NextResponse.next();
  return NextResponse.next({ request: { headers: sanitizedRequestHeaders(request) } });
}

const PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/guides',
  '/book-demo',
  '/terms',
  '/privacy',
  '/admin/login',
  '/admin/pwa-manifest',
  '/attendance/login',
  '/attendance/kiosk',
  '/auth/impersonate',
  /** Razorpay Payment Link `callback_url` lands here (customer has no Khatario session) */
  '/pay/complete',
  '/offline',
]);

function isCustomerSurfacePath(pathname: string): boolean {
  if (pathname.startsWith('/i/')) return true;
  if (pathname.startsWith('/portal/')) return true;
  return false;
}

const PUBLIC_API_PREFIXES = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/impersonate',
  '/api/signup',
  '/api/bookings/create',
  '/api/bookings/available-slots',
  '/api/admin/auth/login',
  '/api/admin/auth/logout',
  '/api/cron/',
  '/api/webhooks/',
  '/api/webhooks/meta-whatsapp',
  '/api/webhooks/platform-billing/',
  /** Razorpay / PayU / etc. POST here; must not require business user session */
  '/api/payments/webhook',
  '/api/health',
  '/api/public/',
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname === '/') return true;
  if (pathname === '/store' || pathname.startsWith('/store/')) return true;
  if (pathname.startsWith('/solution/')) return true;
  if (pathname.startsWith('/media/marketing/')) return true;
  if (isCustomerSurfacePath(pathname)) return true;
  if (isPublicBusinessEmployeePath(pathname)) return true;
  for (const prefix of PUBLIC_API_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

/** Allowlisted ESS APIs with employee portal cookie (session validated in route handlers). */
function tryEmployeePortalApiPassthrough(request: NextRequest): NextResponse | null {
  const token = request.cookies.get(EMPLOYEE_PORTAL_COOKIE)?.value;
  if (!token) return null;
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/api/')) return null;
  if (!isEssApiAllowed(request.method, pathname)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const requestHeaders = sanitizedRequestHeaders(request);
  requestHeaders.set(EMPLOYEE_PORTAL_SESSION_HEADER, '1');
  return NextResponse.next({ request: { headers: requestHeaders } });
}

/** Routes that use the platform-admin JWT cookie only (not business user session). */
function isPlatformAdminProtectedPath(pathname: string): boolean {
  if (pathname.startsWith('/admin/login')) return false;
  if (pathname.startsWith('/admin/pwa-manifest')) return false;
  if (pathname.startsWith('/admin')) return true;
  if (pathname.startsWith('/api/admin/')) {
    if (pathname.startsWith('/api/admin/auth/login')) return false;
    if (pathname.startsWith('/api/admin/auth/logout')) return false;
    return true;
  }
  if (pathname === '/api/policies') return true;
  return false;
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/images/') ||
    pathname.startsWith('/fonts/') ||
    pathname.startsWith('/favicon') ||
    pathname === '/manifest.json' ||
    pathname === '/admin/sw.js' ||
    pathname === '/admin/pwa-manifest' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.woff') ||
    pathname.endsWith('.woff2')
  );
}

/**
 * Allow app-shell GET/RSC when JWT expired but device has a cached offline session.
 * The local-session cookie is client-set and unsigned: it must never grant API access
 * or identity (offline catalog sync authenticates with the signed session cookies).
 */
function allowOfflineAppShellNavigation(request: NextRequest): boolean {
  if (request.method !== 'GET') return false;
  if (request.cookies.get(LOCAL_SESSION_COOKIE)?.value !== '1') return false;
  const rsc = request.headers.get('RSC');
  const nextRouter = request.headers.get('Next-Router-State-Tree');
  const accept = request.headers.get('accept') ?? '';
  return rsc === '1' || !!nextRouter || accept.includes('text/html');
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isStaticAsset(pathname)) return NextResponse.next();

  const storeSubdomain = extractStoreSubdomain(request.headers.get('host'));
  if (storeSubdomain) {
    const url = request.nextUrl.clone();
    // Store hosts never carry a merchant session, and many handlers still fall back to
    // client-supplied user_id/business_id when the session headers are absent.
    if (pathname.startsWith('/api/')) {
      if (isPublicPath(pathname)) return nextWithoutSpoofedIdentity(request);
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }
    // Merchant AuthContext used to bounce guests to /login on the store host.
    // There is no merchant login here — send them to the storefront (or the
    // original store path in `redirect`).
    if (pathname === '/login' || pathname === '/signup') {
      const dest = url.searchParams.get('redirect') || '/';
      const safe =
        dest.startsWith('/') && !dest.startsWith('//') && !dest.startsWith('/login')
          ? dest.split('?')[0]
          : '/';
      url.pathname = safe === '/' ? '/store' : `/store${safe}`;
      url.search = '';
      const response = NextResponse.rewrite(url);
      response.headers.set('x-store-subdomain', storeSubdomain);
      return response;
    }
    url.pathname = pathname === '/' ? '/store' : `/store${pathname}`;
    const response = NextResponse.rewrite(url);
    response.headers.set('x-store-subdomain', storeSubdomain);
    return response;
  }

  if (isPublicPath(pathname)) return nextWithoutSpoofedIdentity(request);

  /** Employee portal ESS APIs: prefer portal cookie over business JWT when both exist. */
  if (pathname.startsWith('/api/') && isEssApiAllowed(request.method, pathname)) {
    const portalPassthrough = tryEmployeePortalApiPassthrough(request);
    if (portalPassthrough) return portalPassthrough;
  }

  /** Public plan catalog (GET only) — landing page + in-app upgrade before platform-admin gate */
  if (pathname === '/api/admin/subscriptions/plans' && request.method === 'GET') {
    return nextWithoutSpoofedIdentity(request);
  }

  /** Sidebar report route map — business app, not platform admin (handler is unauthenticated). */
  if (pathname === '/api/admin/reports' && request.method === 'GET') {
    return nextWithoutSpoofedIdentity(request);
  }

  if (isPlatformAdminProtectedPath(pathname)) {
    const platformPayload = await getPlatformSessionFromRequest(request);
    if (platformPayload) {
      const requestHeaders = sanitizedRequestHeaders(request);
      requestHeaders.set('x-platform-admin-id', platformPayload.adminId);
      requestHeaders.set('x-platform-admin-session-version', String(platformPayload.sv));
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Platform admin authentication required', code: 'UNAUTHENTICATED_PLATFORM' },
        { status: 401 }
      );
    }
    return redirectToBrowserLogin(request, '/admin/login', pathname);
  }

  const { rotate, payload } = await shouldRotateTokens(request);

  if (!payload) {
    if (pathname.startsWith('/api/')) {
      const portalPassthrough = tryEmployeePortalApiPassthrough(request);
      if (portalPassthrough) return portalPassthrough;
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }
    if (allowOfflineAppShellNavigation(request)) {
      return nextWithoutSpoofedIdentity(request);
    }
    return redirectToBrowserLogin(request, '/login', pathname);
  }

  if (typeof payload.sv !== 'number') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }
    if (allowOfflineAppShellNavigation(request)) {
      return nextWithoutSpoofedIdentity(request);
    }
    return redirectToBrowserLogin(request, '/login', pathname);
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (payload.businessId && !uuidRe.test(payload.businessId)) {
    return NextResponse.json({ error: 'Invalid business context', code: 'INVALID_BUSINESS_ID' }, { status: 400 });
  }

  // Optional: reject malformed x-branch-id when clients send branch context (no DB lookup).
  if (process.env.KHATARIO_MIDDLEWARE_VALIDATE_OPTIONAL_BRANCH_HEADER === '1' && pathname.startsWith('/api/')) {
    const branchHeader = request.headers.get('x-branch-id');
    if (branchHeader && !uuidRe.test(branchHeader)) {
      return NextResponse.json({ error: 'Invalid branch context', code: 'INVALID_BRANCH_ID' }, { status: 400 });
    }
  }

  const requestHeaders = sanitizedRequestHeaders(request);
  requestHeaders.set('x-authenticated-user-id', payload.userId);
  requestHeaders.set('x-authenticated-business-id', payload.businessId);
  requestHeaders.set('x-authenticated-session-version', String(payload.sv));

  if (rotate) {
    const refreshUrl = new URL('/api/auth/refresh', request.url);
    let refreshRes: Response;
    let refreshUnreachable = false;
    try {
      refreshRes = await fetch(refreshUrl, {
        method: 'POST',
        headers: { cookie: request.headers.get('cookie') ?? '' },
        cache: 'no-store',
      });
    } catch {
      refreshUnreachable = true;
      refreshRes = { ok: false, headers: new Headers() } as Response;
    }

    if (!refreshRes.ok) {
      if (pathname.startsWith('/api/')) {
        const portalPassthrough = tryEmployeePortalApiPassthrough(request);
        if (portalPassthrough) {
          forwardSetCookies(refreshRes, portalPassthrough);
          return portalPassthrough;
        }
        // Clients hard-logout on SESSION_REVOKED; a refresh endpoint we could not reach is
        // transient and must not cost the user their session.
        const res = refreshUnreachable
          ? NextResponse.json(
              { error: 'Session refresh unavailable', code: 'SESSION_REFRESH_UNAVAILABLE' },
              { status: 503 }
            )
          : NextResponse.json(
              { error: 'Session revoked or expired', code: 'SESSION_REVOKED' },
              { status: 401 }
            );
        forwardSetCookies(refreshRes, res);
        return res;
      }
      if (allowOfflineAppShellNavigation(request)) {
        const res = NextResponse.next({ request: { headers: requestHeaders } });
        forwardSetCookies(refreshRes, res);
        return res;
      }
      const res = redirectToBrowserLogin(request, '/login', pathname);
      forwardSetCookies(refreshRes, res);
      return res;
    }

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    forwardSetCookies(refreshRes, response);
    return response;
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
