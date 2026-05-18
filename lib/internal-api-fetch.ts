import type { NextRequest } from 'next/server';

/**
 * Route Handlers that call other `/api/*` routes via `fetch` must forward the
 * caller's Cookie header. Middleware still runs on that inner request and
 * requires the JWT session cookie; query `user_id` alone is not enough to pass
 * {@link shouldRotateTokens}.
 */
export function internalApiFetchFromRequest(
  request: NextRequest,
  pathWithQuery: string
): Promise<Response> {
  const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
  const origin =
    request.nextUrl?.origin ||
    (() => {
      const host = request.headers.get('host') || '127.0.0.1:3000';
      const proto = request.headers.get('x-forwarded-proto') || 'http';
      return `${proto}://${host}`;
    })();
  const url = new URL(path, origin);
  return fetch(url.toString(), {
    headers: {
      cookie: request.headers.get('cookie') ?? '',
    },
  });
}
