'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { UpgradeDialog } from '@/components/subscription/upgrade/UpgradeDialog';
import { upgradeRequestFromResponse, upgradeRequestKey, type UpgradeRequest } from '@/lib/upgrade/upgrade-request';
import { installUpgradeFetchWatch, isAnyUpgradeDialogMounted } from '@/lib/upgrade/upgrade-fetch-watch';
import { isUpgradeSnoozed } from '@/lib/upgrade/upgrade-snooze';

export interface FeatureUpgradeModalContextValue {
  /** Opens the popup for a denied plan feature (`feature` from JSON). */
  openForPlanDenied: (featureKey?: string) => void;
  /** Opens any version of the upgrade popup. */
  openUpgrade: (req: UpgradeRequest) => void;
  dismiss: () => void;
  /**
   * If `status` + `data` are a plan denial or a limit reply, opens the popup and returns true.
   * `data` should be parsed JSON body (or null). Never stacks a second popup.
   */
  openIfFeatureDeniedResponse: (status: number, data: Record<string, unknown> | null) => boolean;
}

const FeatureUpgradeModalContext = createContext<FeatureUpgradeModalContextValue | null>(null);

function snoozed(req: UpgradeRequest): boolean {
  try {
    return isUpgradeSnoozed(upgradeRequestKey(req), new Date(), window.localStorage);
  } catch {
    return false;
  }
}

/**
 * Owns the one upgrade popup for the app shell. Also watches fetch: a "not in your plan" or
 * "limit reached" reply to any write opens the popup, so screens that only show the error text
 * still offer the upgrade (docs/plan/UNIFIED_UPGRADE_POPUP.md).
 */
export function FeatureUpgradeModalProvider({ children }: { children: React.ReactNode }) {
  const visibleRef = useRef(false);
  const [request, setRequest] = useState<UpgradeRequest | null>(null);

  const dismiss = useCallback(() => {
    visibleRef.current = false;
    setRequest(null);
  }, []);

  const openUpgrade = useCallback((req: UpgradeRequest) => {
    if (visibleRef.current || isAnyUpgradeDialogMounted()) return;
    visibleRef.current = true;
    setRequest(req);
  }, []);

  const openForPlanDenied = useCallback(
    (key?: string) => openUpgrade({ variant: 'feature', ...(key ? { featureKey: key } : {}) }),
    [openUpgrade],
  );

  const openIfFeatureDeniedResponse = useCallback(
    (status: number, data: Record<string, unknown> | null) => {
      // Callers hand over replies they already know failed; treat them like a write.
      const req = upgradeRequestFromResponse('POST', status, data);
      if (!req) return false;
      openUpgrade(req);
      return true;
    },
    [openUpgrade],
  );

  useEffect(
    () =>
      installUpgradeFetchWatch({
        open: (req) => {
          if (!snoozed(req)) openUpgrade(req);
        },
        isDialogOpen: () => visibleRef.current || isAnyUpgradeDialogMounted(),
      }),
    [openUpgrade],
  );

  const value = useMemo<FeatureUpgradeModalContextValue>(
    () => ({ openForPlanDenied, openUpgrade, dismiss, openIfFeatureDeniedResponse }),
    [openForPlanDenied, openUpgrade, dismiss, openIfFeatureDeniedResponse],
  );

  return (
    <FeatureUpgradeModalContext.Provider value={value}>
      {children}
      {request && <UpgradeDialog request={request} onClose={dismiss} />}
    </FeatureUpgradeModalContext.Provider>
  );
}

/** Global upgrade popup controls; must be under {@link FeatureUpgradeModalProvider}. */
export function useFeatureUpgradeModal(): FeatureUpgradeModalContextValue {
  const ctx = useContext(FeatureUpgradeModalContext);
  if (!ctx) {
    throw new Error('useFeatureUpgradeModal must be used within FeatureUpgradeModalProvider');
  }
  return ctx;
}

/** Same as {@link useFeatureUpgradeModal}, or null outside the app shell. */
export function useOptionalFeatureUpgradeModal(): FeatureUpgradeModalContextValue | null {
  return useContext(FeatureUpgradeModalContext);
}
