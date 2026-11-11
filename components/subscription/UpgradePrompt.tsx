'use client';

import { UpgradeModal } from './UpgradeModal';

interface UpgradePromptProps {
  limitType?: 'invoices' | 'customers' | 'items' | 'users' | 'whatsapp' | 'feature';
  currentCount?: number;
  limit?: number;
  featureName?: string;
  featureKey?: string;
  onClose: () => void;
  onPurchaseSuccess?: () => Promise<void>;
}

/** Kept for existing callers; renders the one upgrade popup. */
export function UpgradePrompt({
  limitType = 'feature',
  currentCount,
  limit,
  featureName,
  featureKey,
  onClose,
  onPurchaseSuccess,
}: UpgradePromptProps) {
  return (
    <UpgradeModal
      limitType={limitType}
      currentCount={currentCount}
      limit={limit}
      featureName={featureName}
      featureKey={featureKey}
      onClose={onClose}
      onUpgradeSuccess={onPurchaseSuccess ? () => void onPurchaseSuccess() : undefined}
    />
  );
}
