import { NextRequest, NextResponse } from 'next/server';
import { shouldRotateTokens } from './lib/jwt';
import { getPlatformSessionFromRequest } from './lib/platform-jwt';

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

const PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/guides',
  '/book-demo',
  '/admin/login',
  '/attendance/login',
  '/attendance/kiosk',
  '/auth/impersonate',
  /** Razorpay Payment Link `callback_url` lands here (customer has no Khatario session) */
  '/pay/complete',
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
  '/api/auth/impersonate',
  '/api/signup',
  '/api/admin/auth/login',
  '/api/admin/auth/logout',
  '/api/cron/',
  '/api/webhooks/',
  '/api/webhooks/platform-billing/',
  /** Razorpay / PayU / etc. POST here; must not require business user session */
  '/api/payments/webhook',
  '/api/health',
  '/api/public/',
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname === '/') return true;
  if (isCustomerSurfacePath(pathname)) return true;
  for (const prefix of PUBLIC_API_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

/** Routes that use the platform-admin JWT cookie only (not business user session). */
function isPlatformAdminProtectedPath(pathname: string): boolean {
  if (pathname.startsWith('/admin/login')) return false;
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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isStaticAsset(pathname)) return NextResponse.next();
  if (isPublicPath(pathname)) return NextResponse.next();

  /** Public plan catalog (GET only) — landing page + in-app upgrade before platform-admin gate */
  if (pathname === '/api/admin/subscriptions/plans' && request.method === 'GET') {
    return NextResponse.next();
  }

  if (isPlatformAdminProtectedPath(pathname)) {
    const platformPayload = await getPlatformSessionFromRequest(request);
    if (platformPayload) {
      const requestHeaders = new Headers(request.headers);
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
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const { rotate, payload } = await shouldRotateTokens(request);

  if (!payload) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (typeof payload.sv !== 'number') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
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

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-authenticated-user-id', payload.userId);
  requestHeaders.set('x-authenticated-business-id', payload.businessId);
  requestHeaders.set('x-authenticated-session-version', String(payload.sv));

  if (rotate) {
    const refreshUrl = new URL('/api/auth/refresh', request.url);
    let refreshRes: Response;
    try {
      refreshRes = await fetch(refreshUrl, {
        method: 'POST',
        headers: { cookie: request.headers.get('cookie') ?? '' },
        cache: 'no-store',
      });
    } catch {
      refreshRes = { ok: false, headers: new Headers() } as Response;
    }

    if (!refreshRes.ok) {
      if (pathname.startsWith('/api/')) {
        const res = NextResponse.json(
          { error: 'Authentication required', code: 'UNAUTHENTICATED' },
          { status: 401 }
        );
        forwardSetCookies(refreshRes, res);
        return res;
      }
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      const res = NextResponse.redirect(loginUrl);
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
