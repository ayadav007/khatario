/** Pages a phone-only (Free) business can still open in the browser: choosing and paying for a plan. */
export const WEB_GATE_OPEN_PREFIXES = ['/settings/subscription', '/settings/products', '/upgrade', '/profile'];

/**
 * Whether the website shows the "Free works in the Android app" wall instead of the page.
 * Pages the Flutter app opens in its own web view are the app, not the website.
 */
export function shouldBlockWeb(opts: { allowed: boolean | null; inPhoneApp: boolean; pathname: string | null }): boolean {
  if (opts.allowed !== false || opts.inPhoneApp) return false;
  const path = opts.pathname ?? '';
  return !WEB_GATE_OPEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
