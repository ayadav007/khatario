'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { useFeatureUpgradeModal } from '@/contexts/FeatureUpgradeModalContext';
import { getFeatureDisplayName } from '@/lib/feature-upgrade-labels';

export interface PlanFeatureDeniedCalloutProps {
  /** Canonical / registry feature key (matches API `feature` on 403). */
  featureKey: string;
  title?: string;
  description?: string;
  /** Opens the global {@link UpgradePrompt} once when this callout mounts. */
  autoOpenUpgradeModal?: boolean;
  className?: string;
}

/**
 * Inline plan-denied messaging with a primary CTA — use instead of passive error-only banners
 * so users always get {@link UpgradePrompt} / plan selection via {@link FeatureUpgradeModalProvider}.
 */
export function PlanFeatureDeniedCallout({
  featureKey,
  title,
  description,
  autoOpenUpgradeModal = false,
  className = '',
}: PlanFeatureDeniedCalloutProps) {
  const { openForPlanDenied } = useFeatureUpgradeModal();
  const openedRef = useRef(false);

  useEffect(() => {
    if (!autoOpenUpgradeModal || openedRef.current) return;
    openedRef.current = true;
    openForPlanDenied(featureKey);
  }, [autoOpenUpgradeModal, featureKey, openForPlanDenied]);

  const displayName = getFeatureDisplayName(featureKey);
  const headline = title ?? `${displayName} is not available on your current plan`;

  return (
    <div
      role="alert"
      className={`rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100 ${className}`}
    >
      <p className="font-medium text-red-900 dark:text-red-50">{headline}</p>
      <p className="mt-1 text-sm opacity-95">
        {description ??
          'Upgrade your subscription or add-ons to unlock this feature. You can review plans anytime with the button below.'}
      </p>
      <Button
        type="button"
        variant="primary"
        className="mt-3"
        onClick={() => openForPlanDenied(featureKey)}
      >
        View plans & upgrade
      </Button>
    </div>
  );
}
