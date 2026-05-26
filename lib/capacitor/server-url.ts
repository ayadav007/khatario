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

/** Query param set when Capacitor errorPath redirects into the cached remote app. */
export const OFFLINE_BOOTSTRAP_PARAM = 'khatario_offline_bootstrap';

/**
 * Target for cold-start offline bootstrap — cached login shell on the remote origin.
 * Login is SW-precached (public); AuthContext restores session and routes to dashboard.
 */
export function resolveOfflineBootstrapUrl(raw?: string): string {
  const loginUrl = resolveCapacitorServerUrl(raw);
  try {
    const url = new URL(loginUrl);
    url.pathname = '/login';
    url.search = `${OFFLINE_BOOTSTRAP_PARAM}=1`;
    return url.href;
  } catch {
    const base = loginUrl.replace(/\/login\/?$/, '');
    return `${base}/login?${OFFLINE_BOOTSTRAP_PARAM}=1`;
  }
}
