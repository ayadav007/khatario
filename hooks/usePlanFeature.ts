'use client';

import { useLayoutData } from '@/contexts/LayoutDataContext';

/**
 * Whether the current business plan includes a feature.
 * Reads the same list the app shell uses. While that list is still loading, returns false
 * so a turned-off feature does not flash on.
 */
export function usePlanFeature(featureId: string): boolean {
  const { snapshotLoaded, loading, enabledFeatureIds } = useLayoutData();
  if (!snapshotLoaded || loading) return false;
  return enabledFeatureIds.includes(featureId);
}
