'use client';

import { useCapabilityCheck } from '@/hooks/useCapability';
import { hasFullHrFeatures } from '@/lib/subscription/hr-lite';

/** True when leave/portal (Full HR) is on the plan. False for Billing HR Lite. */
export function useFullHr(): boolean {
  const { hasCapability } = useCapabilityCheck();
  return hasFullHrFeatures((key) => hasCapability(key, 'view'));
}
