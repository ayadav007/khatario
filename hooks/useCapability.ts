'use client';

/**
 * Unified Capability Hook — Single source of truth for permission and feature checks.
 *
 * Uses capability snapshot (from LayoutDataContext bootstrap).
 * When offline: uses last-known server state. No default deny during loading.
 *
 * Server remains source of truth. Client logic is UX only.
 * 
 * All resource/action/feature normalization is handled by capability-normalizer.ts
 */

import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { evaluateCapabilityAccess } from '@/lib/capability-eval';

export interface UseCapabilityResult {
  /** Whether capability check passed */
  allowed: boolean;
  /** True while snapshot not yet loaded — never deny during loading */
  loading: boolean;
  /** Reason for denial (only when allowed=false) */
  reason?: string;
  /** Check any resource+action. Use this for multiple checks (e.g. Sidebar). */
  hasCapability: (resource: string, action?: string) => boolean;
}

/**
 * Unified capability check.
 *
 * @param resource - Module name (e.g. "invoices", "dashboard") or feature key (e.g. "sales_estimates", "todo")
 * @param action - Any action name (will be normalized to canonical: read/create/update/delete/export)
 */
export function useCapability(
  resource: string,
  action: string = 'view'
): UseCapabilityResult {
  const { user, business, isPrimaryAdmin: sessionIsPrimaryAdmin, permissions: sessionPermissions } =
    useAuth();
  const { snapshotLoaded } = useLayoutData();

  return useMemo(() => {
    const hasCapability = (res: string, act?: string): boolean => {
      if (!business?.id || !user?.id) return false;
      return evaluateCapabilityAccess({
        resource: res,
        action: act,
        businessId: business.id,
        userId: user.id,
        sessionIsPrimaryAdmin,
        sessionPermissions,
      }).allowed;
    };

    const loading = !snapshotLoaded;
    const allowed = loading ? false : hasCapability(resource, action);

    return {
      allowed,
      loading,
      reason: allowed ? undefined : 'Feature or permission not enabled',
      hasCapability,
    };
  }, [
    resource,
    action,
    user?.id,
    business?.id,
    snapshotLoaded,
    sessionIsPrimaryAdmin,
    sessionPermissions,
  ]);
}

/**
 * Hook that returns only hasCapability and snapshotLoaded.
 * Use when you need to check many resources (e.g. Sidebar).
 */
export function useCapabilityCheck(): {
  hasCapability: (resource: string, action?: string) => boolean;
  snapshotLoaded: boolean;
  loading: boolean;
} {
  const { user, business, isPrimaryAdmin: sessionIsPrimaryAdmin, permissions: sessionPermissions } =
    useAuth();
  const { snapshotLoaded } = useLayoutData();

  const hasCapability = useMemo(() => {
    return (res: string, act?: string): boolean => {
      if (!business?.id || !user?.id) return false;
      return evaluateCapabilityAccess({
        resource: res,
        action: act,
        businessId: business.id,
        userId: user.id,
        sessionIsPrimaryAdmin,
        sessionPermissions,
      }).allowed;
    };
    // snapshotLoaded must be a dependency so consumers (e.g. Sidebar) recompute when
    // LayoutDataContext finishes bootstrap and localStorage snapshot is authoritative.
  }, [user?.id, business?.id, snapshotLoaded, sessionIsPrimaryAdmin, sessionPermissions]);

  return {
    hasCapability,
    snapshotLoaded,
    loading: !snapshotLoaded,
  };
}
