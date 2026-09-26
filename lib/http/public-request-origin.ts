/**
 * Origin the browser should see in redirects.
 * Behind nginx, Next may think it is http://127.0.0.1:3100 — never send that to the user.
 */
export function resolvePublicRequestOrigin(request: {
  headers: { get(name: string): string | null };
  nextUrl: { origin: string; protocol: string };
}): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const hostHeader = request.headers.get('host')?.split(',')[0]?.trim();
  const host = forwardedHost || hostHeader || '';
  const loopback =
    !host ||
    host.startsWith('127.') ||
    host.startsWith('localhost') ||
    host.startsWith('[::1]') ||
    host.startsWith('[::1]:');

  const protoHeader = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto =
    protoHeader === 'http' || protoHeader === 'https'
      ? protoHeader
      : request.nextUrl.protocol.replace(':', '') || 'https';

  if (!loopback && host) {
    return `${proto}://${host}`;
  }

  // Production bind is 127.0.0.1; never send that to the browser.
  if (process.env.NODE_ENV === 'production') {
    const app = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
    if (app) return app;
  }

  return request.nextUrl.origin;
}
