'use client';

import { useEffect, useRef } from 'react';
import { Lock } from 'lucide-react';
import { useFeatureUpgradeModal } from '@/contexts/FeatureUpgradeModalContext';
import { getFeatureDisplayName } from '@/lib/feature-upgrade-labels';

export interface PlanFeatureDeniedCalloutProps {
  /** Canonical / registry feature key (matches API `feature` on 403). */
  featureKey: string;
  title?: string;
  description?: string;
  /** Opens the upgrade popup once when this callout mounts. */
  autoOpenUpgradeModal?: boolean;
  className?: string;
}

/**
 * Inline "not in your plan" note in the upgrade popup's style; its button opens the popup
 * via {@link FeatureUpgradeModalProvider}.
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

  return (
    <div role="alert" className={`flex items-start gap-3 rounded-xl border border-[#f6c9a2] bg-[#F8F3E9] px-4 py-3 ${className}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-600 text-accent-500">
        <Lock className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-primary-600">{title ?? `Sorry, ${displayName} isn't in your plan`}</p>
        <p className="mt-0.5 text-sm text-[#5c5247]">
          {description ?? "Upgrade to use it. Everything you've made stays as it is."}
        </p>
        <button
          type="button"
          onClick={() => openForPlanDenied(featureKey)}
          className="mt-2 rounded-lg bg-accent-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-600"
        >
          See plans
        </button>
      </div>
    </div>
  );
}
