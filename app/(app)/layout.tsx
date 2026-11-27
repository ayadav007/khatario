import { createElement, type ReactNode } from 'react';
import { headers } from 'next/headers';
import { AppRouteShell } from '@/components/layout/AppRouteShell';
import { PlanCheckFailedScreen, SeatPausedScreen, WebAccessWall } from '@/components/layout/AppGateScreens';
import { resolveServerAppGate } from '@/lib/subscription/app-gate';
import { SEAT_PAUSED_MESSAGE } from '@/lib/subscription/over-limit-access';

/**
 * Server layout for the business app pages. It checks the plan on the server before any page renders, so a
 * Free (phone-app-only) business gets the upgrade wall with JavaScript turned off too (SUB-19), and a user whose
 * seat is paused gets the plain notice (SUB-24). The interactive shell itself is the client component
 * `AppRouteShell` (it used to be this file). Written with createElement so a DB test can run it without a JSX
 * transform.
 */
export default async function AppRouteLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const gate = await resolveServerAppGate({
    businessId: h.get('x-authenticated-business-id'),
    userId: h.get('x-authenticated-user-id'),
    pathname: h.get('x-khatario-pathname'),
    userAgent: h.get('user-agent'),
  });

  if (gate === 'web_wall') return createElement(WebAccessWall);
  if (gate === 'check_failed') return createElement(PlanCheckFailedScreen);
  if (gate === 'seat_paused') return createElement(SeatPausedScreen, { message: SEAT_PAUSED_MESSAGE });
  return createElement(AppRouteShell, null, children);
}
