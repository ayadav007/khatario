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
