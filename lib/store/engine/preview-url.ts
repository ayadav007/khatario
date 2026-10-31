// Server-only. The storefront URL for a preview link, on the store's own host as the merchant's browser reaches it.
import type { NextRequest } from 'next/server';
import { storeHostSuffix, storePublicHostname } from '@/lib/store/subdomain';

/**
 * `<proto>://<store host>[:port]<path>?preview_theme=<previewId>&pt=<token>`. The app host and protocol come from the
 * proxy headers; the port is kept only for `*.localhost` development hosts.
 */
export function storePreviewUrl(request: NextRequest, subdomain: string, path: string, previewId: string, token: string): string {
  const hostHeader = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
  const [appHostname, appPort] = hostHeader.split(',')[0].trim().split(':');
  const proto = (request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '')).split(',')[0].trim();
  const port = storeHostSuffix(appHostname) === '.localhost' && appPort ? `:${appPort}` : '';
  return `${proto}://${storePublicHostname(subdomain, appHostname)}${port}${path}?preview_theme=${previewId}&pt=${encodeURIComponent(token)}`;
}
