// Client-safe: the address of a theme demo store (demo-<slug>) as the visitor's browser reaches it.
import { storeHostSuffix, storePublicHostname } from '@/lib/store/subdomain';

/**
 * `<proto>://<demo store host>[:port]<path>[?embed=1]`, on the store hosts that go with `appHost` (the host the theme
 * store page was opened on). Staging and production store hosts are https only; `*.localhost` keeps the request's
 * protocol and port (the same rules as storePreviewUrl).
 */
export function demoStoreUrl(appHost: string, proto: string, subdomain: string, path: string, embed: boolean): string {
  const [hostname, port] = appHost.split(',')[0].trim().split(':');
  const local = storeHostSuffix(hostname) === '.localhost';
  const scheme = local ? proto.split(',')[0].trim().replace(':', '') || 'http' : 'https';
  const origin = `${scheme}://${storePublicHostname(subdomain, hostname)}${local && port ? `:${port}` : ''}`;
  return `${origin}${path}${embed ? `${path.includes('?') ? '&' : '?'}embed=1` : ''}`;
}
