/**
 * Store hostnames:
 *   staging:    {store}.staging.khatario.com
 *   production: {store}.khatario.com
 * Returns null for the main app hosts (staging, app, www, apex, localhost).
 */

const STORE_LABEL = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

const MAIN_APP_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'staging.khatario.com',
  'app.khatario.com',
  'khatario.com',
  'www.khatario.com',
]);

const RESERVED_STORE_LABELS = new Set([
  'staging',
  'app',
  'www',
  'api',
]);

function storeLabel(value: string): string | null {
  if (!STORE_LABEL.test(value) || RESERVED_STORE_LABELS.has(value)) return null;
  return value;
}

export function extractStoreSubdomain(host: string | null): string | null {
  if (!host) return null;

  const hostname = host.split(':')[0].toLowerCase().trim();
  if (MAIN_APP_HOSTS.has(hostname)) return null;

  // Staging stores: {store}.staging.khatario.com
  const stagingMatch = hostname.match(
    /^([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\.staging\.khatario\.com$/,
  );
  if (stagingMatch) return storeLabel(stagingMatch[1]);

  // Production stores: {store}.khatario.com
  const prodMatch = hostname.match(
    /^([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\.khatario\.com$/,
  );
  if (prodMatch) return storeLabel(prodMatch[1]);

  // Dev: {store}.localhost
  const devMatch = hostname.match(
    /^([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\.localhost$/,
  );
  if (devMatch) return storeLabel(devMatch[1]);

  return null;
}

/** Suffix shown beside the store name in settings. Includes the leading dot. */
export function storeHostSuffix(appHostname: string): string {
  const host = appHostname.split(':')[0].toLowerCase().trim();
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) {
    return '.localhost';
  }
  if (host === 'staging.khatario.com' || host.endsWith('.staging.khatario.com')) {
    return '.staging.khatario.com';
  }
  return '.khatario.com';
}

export function storePublicHostname(storeSubdomain: string, appHostname: string): string {
  return `${storeSubdomain}${storeHostSuffix(appHostname)}`;
}
