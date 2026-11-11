'use client';

import { useMemo } from 'react';
import type { PlatformModule } from '@/lib/platform-modules';
import { ADDON_FEATURE_KEYS, type UpgradeRequest } from '@/lib/upgrade/upgrade-request';
import { UpgradeDialog } from '@/components/subscription/upgrade/UpgradeDialog';

interface UpgradeModalProps {
  limitType?: 'invoices' | 'customers' | 'items' | 'users' | 'employees' | 'whatsapp' | 'feature';
  currentCount?: number;
  limit?: number;
  featureName?: string;
  /** Registry feature id, when the caller knows it (better plan pick and copy). */
  featureKey?: string;
  /** Pre-select a plan (e.g. limit recommendation). */
  initialPlanId?: string;
  /** Scope plan list + checkout to this product module. */
  moduleKey?: PlatformModule;
  /** Adding a product: open straight on the plan list with the trial card. */
  showTrialOption?: boolean;
  onClose: () => void;
  onUpgradeSuccess?: () => void;
}

/** Props of the old upgrade modal mapped onto the one upgrade popup. */
export function upgradeRequestFromModalProps(p: Omit<UpgradeModalProps, 'onClose' | 'onUpgradeSuccess'>): UpgradeRequest {
  const shared = {
    ...(p.moduleKey ? { moduleKey: p.moduleKey } : {}),
    ...(p.initialPlanId ? { initialPlanId: p.initialPlanId } : {}),
    ...(p.showTrialOption ? { showTrialOption: true } : {}),
  };
  if (!p.limitType || p.limitType === 'feature') {
    const addon = p.moduleKey === 'connect' || (!!p.featureKey && ADDON_FEATURE_KEYS.has(p.featureKey));
    return {
      variant: addon ? 'addon' : 'feature',
      ...(p.featureKey ? { featureKey: p.featureKey } : {}),
      ...(p.featureName ? { featureName: p.featureName } : {}),
      ...shared,
    };
  }
  return {
    variant: 'limit',
    limitType: p.limitType,
    ...(p.limit !== undefined ? { limit: p.limit } : {}),
    ...(p.currentCount !== undefined ? { current: p.currentCount } : {}),
    ...shared,
  };
}

export function UpgradeModal({
  limitType,
  currentCount,
  limit,
  featureName,
  featureKey,
  initialPlanId,
  moduleKey,
  showTrialOption,
  onClose,
  onUpgradeSuccess,
}: UpgradeModalProps) {
  const request = useMemo(
    () => upgradeRequestFromModalProps({ limitType, currentCount, limit, featureName, featureKey, initialPlanId, moduleKey, showTrialOption }),
    [limitType, currentCount, limit, featureName, featureKey, initialPlanId, moduleKey, showTrialOption],
  );
  return <UpgradeDialog request={request} onClose={onClose} onUpgradeSuccess={onUpgradeSuccess} />;
}
