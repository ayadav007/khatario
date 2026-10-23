'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { moduleForPath } from '@/lib/platform-modules';
import { featureIdForPath, isSupplierHubHref } from '@/lib/subscription/plan-path-gate';
import { PlanFeatureDeniedCallout } from '@/components/subscription/PlanFeatureDeniedCallout';
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
  const { loading: planLoading, snapshotLoaded, enabledFeatureIds, supplierHubVisible } = useLayoutData();
  const homeHref = platformSession?.defaultHomePath ?? '/dashboard';
  const hubPath = isSupplierHubHref(pathname);
  const hubHidden = hubPath && supplierHubVisible === false;

  const requiredFeature = featureIdForPath(pathname);
  const planKnown = snapshotLoaded && !planLoading;
  const blockedByPlan =
    planKnown &&
    !!requiredFeature &&
    !enabledFeatureIds.includes(requiredFeature);

  useEffect(() => {
    if (hubHidden) {
      router.replace(homeHref);
      return;
    }
    if (loading || !pathname || blockedByPlan) return;

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
  }, [blockedByPlan, homeHref, hubHidden, loading, pathname, platformSession, router, user]);

  if (hubPath && supplierHubVisible === null) return null;
  if (hubHidden) return null;

  if (blockedByPlan && requiredFeature) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <PlanFeatureDeniedCallout featureKey={requiredFeature} autoOpenUpgradeModal />
      </div>
    );
  }

  return <>{children}</>;
}
