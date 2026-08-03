/**
 * Extract store subdomain from the Host header.
 * Returns null if the host is the main app domain (staging, app, www, bare domain).
 */

const MAIN_APP_HOSTS = new Set([
  'localhost',
  'staging.khatario.com',
  'app.khatario.com',
  'khatario.com',
  'www.khatario.com',
]);

export function extractStoreSubdomain(host: string | null): string | null {
  if (!host) return null;

  const hostname = host.split(':')[0].toLowerCase().trim();

  if (MAIN_APP_HOSTS.has(hostname)) return null;

  // localhost with port — dev mode
  if (hostname === 'localhost' || hostname === '127.0.0.1') return null;

  // Match {subdomain}.khatario.com
  const match = hostname.match(/^([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\.khatario\.com$/);
  if (match) {
    const sub = match[1];
    // Exclude known main subdomains
    if (sub === 'staging' || sub === 'app' || sub === 'www' || sub === 'api') return null;
    return sub;
  }

  // Dev mode: support {subdomain}.localhost:3000 for local testing
  const devMatch = hostname.match(/^([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\.localhost$/);
  if (devMatch) {
    const sub = devMatch[1];
    if (sub === 'staging' || sub === 'app' || sub === 'www' || sub === 'api') return null;
    return sub;
  }

  return null;
}
