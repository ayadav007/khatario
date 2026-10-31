// Server-only. The storefront URL for a preview link, on the store's own host as the merchant's browser reaches it.
import type { NextRequest } from 'next/server';
import { storeHostSuffix, storePublicHostname } from '@/lib/store/subdomain';

/**
 * `<proto>://<store host>[:port]<path>?preview_theme=<previewId>&pt=<token>`. The app host comes from the proxy
 * headers. Store hosts on staging and production are https only, so the protocol is https there whatever the proxy
 * says (Cloudflare reaches staging's nginx over plain http, and an http frame inside the https editor is blocked).
 * On `*.localhost` development hosts the request protocol and port are kept.
 */
export function storePreviewUrl(request: NextRequest, subdomain: string, path: string, previewId: string, token: string): string {
  const hostHeader = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
  const [appHostname, appPort] = hostHeader.split(',')[0].trim().split(':');
  const local = storeHostSuffix(appHostname) === '.localhost';
  const proto = local
    ? (request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '')).split(',')[0].trim()
    : 'https';
  const port = local && appPort ? `:${appPort}` : '';
  return `${proto}://${storePublicHostname(subdomain, appHostname)}${port}${path}?preview_theme=${previewId}&pt=${encodeURIComponent(token)}`;
}
