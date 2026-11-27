/**
 * What the server renders for a business app page before any page code runs (SUB-19, SUB-24).
 *
 *  - 'web_wall'     the Free Billing plan works only in the phone app: the browser gets the upgrade wall instead
 *                   of the page (plan pages stay open). Turning JavaScript off does not bypass it.
 *  - 'check_failed' the plan check errored: fail closed with a retry, never the app.
 *  - 'seat_paused'  the signed-in user holds a seat beyond the plan's seats (see over-limit-access.ts).
 *  - 'open'         render the page.
 *
 * API routes are never gated here (the phone app calls them), and a page opened inside the phone app's web view
 * is not "the website": the app's web view adds the `KhatarioPhone` mark to its user agent
 * (lib/capacitor/platform.ts PHONE_APP_USER_AGENT_MARK), the same mark the browser gate already uses.
 * The mark is only a header, so this is a product gate, not a security boundary.
 */
import { businessHasWebAccess } from '@/lib/subscription/web-access';
import { isUserSeatPaused } from '@/lib/subscription/over-limit-access';
import { isInsidePhoneApp } from '@/lib/capacitor/platform';
import { shouldBlockWeb } from '@/lib/upgrade/web-gate';

export type ServerAppGate = 'open' | 'web_wall' | 'check_failed' | 'seat_paused';

export async function resolveServerAppGate(input: {
  businessId: string | null;
  userId: string | null;
  pathname: string | null;
  userAgent: string | null;
}): Promise<ServerAppGate> {
  // No verified session on the request (offline app shell, public path): the client gate and the API checks apply.
  if (!input.businessId) return 'open';

  if (input.userId && (await isUserSeatPaused(input.userId, input.businessId))) return 'seat_paused';

  const inPhoneApp = isInsidePhoneApp(input.userAgent ?? '');
  if (inPhoneApp) return 'open';

  let allowed: boolean;
  try {
    allowed = await businessHasWebAccess(input.businessId);
  } catch (error) {
    console.error('[app-gate] web access check failed, showing the retry screen:', error);
    return 'check_failed';
  }
  return shouldBlockWeb({ allowed, inPhoneApp, pathname: input.pathname }) ? 'web_wall' : 'open';
}
