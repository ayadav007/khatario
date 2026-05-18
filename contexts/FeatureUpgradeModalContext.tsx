'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { UpgradePrompt } from '@/components/subscription/UpgradePrompt';
import { getFeatureDisplayName } from '@/lib/feature-upgrade-labels';
import { isFeatureDeniedResponse } from '@/lib/api-utils';

export interface FeatureUpgradeModalContextValue {
  /** Opens the modal for a denied plan feature (`feature` from JSON). */
  openForPlanDenied: (featureKey?: string) => void;
  dismiss: () => void;
  /**
   * If `status` + `data` indicate plan feature denial, opens the modal and returns true.
   * `data` should be parsed JSON body (or null).
   * If the modal is already open, returns true without stacking another instance.
   */
  openIfFeatureDeniedResponse: (
    status: number,
    data: Record<string, unknown> | null
  ) => boolean;
}

const FeatureUpgradeModalContext =
  createContext<FeatureUpgradeModalContextValue | null>(null);

export function FeatureUpgradeModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const visibleRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [featureKey, setFeatureKey] = useState<string | undefined>(undefined);

  const dismiss = useCallback(() => {
    visibleRef.current = false;
    setOpen(false);
    setFeatureKey(undefined);
  }, []);

  const openForPlanDenied = useCallback((key?: string) => {
    if (visibleRef.current) {
      return;
    }
    visibleRef.current = true;
    setFeatureKey(key);
    setOpen(true);
  }, []);

  const openIfFeatureDeniedResponse = useCallback(
    (status: number, data: Record<string, unknown> | null) => {
      if (!isFeatureDeniedResponse(status, data)) return false;
      const fk =
        typeof data?.feature === 'string' ? (data.feature as string) : undefined;

      if (visibleRef.current) {
        return true;
      }

      visibleRef.current = true;
      setFeatureKey(fk);
      setOpen(true);
      return true;
    },
    []
  );

  const value = useMemo<FeatureUpgradeModalContextValue>(
    () => ({
      openForPlanDenied,
      dismiss,
      openIfFeatureDeniedResponse,
    }),
    [openForPlanDenied, dismiss, openIfFeatureDeniedResponse]
  );

  const displayName = getFeatureDisplayName(featureKey);

  return (
    <FeatureUpgradeModalContext.Provider value={value}>
      {children}
      {open && (
        <UpgradePrompt
          limitType="feature"
          featureKey={featureKey}
          featureName={displayName}
          onClose={dismiss}
        />
      )}
    </FeatureUpgradeModalContext.Provider>
  );
}

/** Global upgrade modal controls; must be under {@link FeatureUpgradeModalProvider}. */
export function useFeatureUpgradeModal(): FeatureUpgradeModalContextValue {
  const ctx = useContext(FeatureUpgradeModalContext);
  if (!ctx) {
    throw new Error(
      'useFeatureUpgradeModal must be used within FeatureUpgradeModalProvider'
    );
  }
  return ctx;
}
