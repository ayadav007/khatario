'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { useCapabilityCheck } from '@/hooks/useCapability';
import { evaluateCapabilityAccess } from '@/lib/capability-eval';

export type AuthorizationStatus = 'loading' | 'allowed' | 'denied';

export interface AuthorizationCheckResult {
  /** Tri-state authorization status - authoritative source of truth */
  status: AuthorizationStatus;
  /** Legacy boolean for backward compatibility (derived from status) */
  allowed: boolean;
  /** Legacy boolean for backward compatibility (derived from status) */
  loading: boolean;
  /** Reason for denial (only set when status === 'denied') */
  reason?: string;
  /** Error code (only set when status === 'denied') */
  code?: string;
}

export interface AuthorizationGuardOptions {
  resource: string;
  action: 'read' | 'create' | 'update' | 'delete' | 'export' | 'finalize' | 'cancel';
  resourceId?: string;
  branchId?: string;
  warehouseId?: string;
  businessId?: string;
  skipCheck?: boolean;
}

/**
 * useAuthorizationGuard Hook
 *
 * Authorization strategy:
 * - Primary admin: instant allow (no API call, no loading state)
 * - Other users: use cached capability snapshot immediately (no blocking spinner),
 *   then verify with server in background. If server disagrees, update state.
 *
 * This ensures pages render instantly without "Checking permissions..." delays.
 * Server-side enforcement still happens on actual mutations (create/update/delete).
 */
export function useAuthorizationGuard(
  options: AuthorizationGuardOptions
): AuthorizationCheckResult {
  const { user, business, isPrimaryAdmin, permissions: sessionPermissions } = useAuth();
  const { snapshotLoaded } = useLayoutData();
  const { hasCapability } = useCapabilityCheck();

  const isAdmin = isPrimaryAdmin || user?.is_primary_admin;

  const [status, setStatus] = useState<AuthorizationStatus>('loading');
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [code, setCode] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (options.skipCheck || !user?.id || !business?.id) {
      setStatus('loading');
      setReason(undefined);
      setCode(undefined);
      return;
    }

    if (!snapshotLoaded) {
      setStatus('loading');
      return;
    }

    const { allowed: cachedAllowed, denialReason } = evaluateCapabilityAccess({
      resource: options.resource,
      action: options.action,
      businessId: business.id,
      userId: user.id,
      sessionIsPrimaryAdmin: !!isAdmin,
      sessionPermissions,
    });

    if (!cachedAllowed) {
      setStatus('denied');
      if (denialReason === 'FEATURE_NOT_IN_PLAN') {
        setReason(
          'This module is not included in your current subscription plan. Upgrade your plan or add the relevant add-on to unlock it.'
        );
        setCode('FEATURE_NOT_IN_PLAN');
      } else {
        setReason(
          'Your account does not have permission for this action. Ask your organization admin to grant access in Settings → Roles.'
        );
        setCode('PAGE_ACCESS_DENIED');
      }
      return;
    }

    setStatus('allowed');
    setReason(undefined);
    setCode(undefined);

    // Primary admin: snapshot is sufficient (server preview uses same rules)
    if (isAdmin) {
      return;
    }

    if (!navigator.onLine) return;

    // Background server verification for non-admin users
    const params = new URLSearchParams({
      user_id: user.id,
      resource: options.resource,
      action: options.action,
    });
    if (options.resourceId) params.append('resource_id', options.resourceId);
    if (options.branchId) params.append('branch_id', options.branchId);
    else if (business?.id && !options.warehouseId)
      params.append('business_id', business.id);
    if (options.warehouseId) params.append('warehouse_id', options.warehouseId);
    if (options.businessId) params.append('business_id', options.businessId);

    let cancelled = false;

    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        // Timeout: keep whatever the snapshot said (already set above)
      }
    }, 5000);

    fetch(`/api/authorization/preview?${params.toString()}`)
      .then(async (res) => {
        clearTimeout(timeoutId);
        if (cancelled) return;
        const data = await res.json();

        if (!res.ok) {
          setStatus('denied');
          setReason(data.reason || 'Authorization check failed');
          setCode(data.code);
          return;
        }

        if (data.allowed === true) {
          setStatus('allowed');
          setReason(undefined);
          setCode(undefined);
        } else {
          setStatus('denied');
          const d = data.details as { code?: string } | undefined;
          if (
            data.code === 'FEATURE_NOT_IN_PLAN' ||
            data.code === 'FEATURE_NOT_AVAILABLE' ||
            d?.code === 'FEATURE_NOT_IN_PLAN' ||
            d?.code === 'FEATURE_NOT_AVAILABLE'
          ) {
            setCode('FEATURE_NOT_IN_PLAN');
            setReason(
              'This module is not included in your current subscription plan. Upgrade your plan or add the relevant add-on to unlock it.'
            );
          } else {
            setReason(
              data.reason ||
                'Your account does not have permission for this action. Ask your organization admin to grant access in Settings → Roles.'
            );
            setCode(data.code || 'PAGE_ACCESS_DENIED');
          }
        }
      })
      .catch(() => {
        clearTimeout(timeoutId);
        // Network error: keep cached snapshot result (already set above)
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [
    user?.id,
    business?.id,
    isAdmin,
    options.resource,
    options.action,
    options.resourceId,
    options.branchId,
    options.warehouseId,
    options.businessId,
    options.skipCheck,
    snapshotLoaded,
    hasCapability,
    sessionPermissions,
  ]);

  return {
    status,
    allowed: status === 'allowed',
    loading: status === 'loading',
    reason: status === 'denied' ? reason : undefined,
    code: status === 'denied' ? code : undefined,
  };
}
