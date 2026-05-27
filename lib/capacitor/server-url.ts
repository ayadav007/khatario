const DEFAULT_SERVER = 'https://app.khatario.com';

/**
 * URL the Capacitor WebView loads on cold start.
 * The native app should open login, not the public marketing home page.
 */
export function resolveCapacitorServerUrl(raw?: string): string {
  const input = (raw || DEFAULT_SERVER).trim();
  try {
    const url = new URL(input);
    if (url.pathname === '/' || url.pathname === '') {
      url.pathname = '/login';
    }
    return url.href;
  } catch {
    const base = input.replace(/\/$/, '');
    return base.endsWith('/login') ? base : `${base}/login`;
  }
}

/**
 * Target for cold-start offline bootstrap.
 * /dashboard is SW-precached; AuthContext restores session from localStorage
 * and hydrates from IndexedDB without network access.
 */
export function resolveOfflineBootstrapUrl(raw?: string): string {
  const serverUrl = resolveCapacitorServerUrl(raw);
  try {
    const url = new URL(serverUrl);
    url.pathname = '/dashboard';
    url.search = '';
    return url.href;
  } catch {
    const base = serverUrl.replace(/\/(login|dashboard)\/?$/, '');
    return `${base}/dashboard`;
  }
}
