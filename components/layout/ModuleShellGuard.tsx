'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { moduleForPath } from '@/lib/platform-modules';
import {
  CONNECT_AGENT_HOME_PATH,
  isConnectAgentSeat,
} from '@/lib/users/connect-seats';
import { isConnectAgentLookupPath } from '@/lib/navigation/sales-nav-items';

const ALWAYS_ALLOWED_PREFIXES = ['/settings', '/more', '/profile', '/hr/dashboard'];

/** Billing shell routes Connect agents must not land on (no dashboard PBAC). */
const CONNECT_AGENT_BLOCKED_PREFIXES = ['/dashboard'];

function isAlwaysAllowed(pathname: string): boolean {
  return ALWAYS_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isConnectAgentBlockedPath(pathname: string): boolean {
  return CONNECT_AGENT_BLOCKED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Redirects users away from module routes they have not enabled yet.
 * Also keeps Connect agents off the billing dashboard (stale cache / deep links).
 * Upsell UI comes later; for now we send them to their default home.
 */
export function ModuleShellGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, platformSession, user } = useAuth();

  useEffect(() => {
    if (loading || !pathname) return;

    if (isConnectAgentSeat(user) && isConnectAgentBlockedPath(pathname)) {
      router.replace(CONNECT_AGENT_HOME_PATH);
      return;
    }

    if (!platformSession) return;
    if (isAlwaysAllowed(pathname)) return;

    // Agents may open invoice/order/customer lookups even when Billing is not the
    // primary product; page-level withPageAuth still enforces RBAC.
    if (isConnectAgentSeat(user) && isConnectAgentLookupPath(pathname)) {
      return;
    }

    const requiredModule = moduleForPath(pathname);
    if (!requiredModule) return;

    if (!platformSession.enabledModules.includes(requiredModule)) {
      router.replace(`/settings/products?upsell=${requiredModule}`);
    }
  }, [loading, pathname, platformSession, router, user]);

  return <>{children}</>;
}
