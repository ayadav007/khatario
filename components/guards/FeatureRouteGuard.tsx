'use client';

import React from 'react';
import { useFeatureRouteGuard } from '@/hooks/useFeatureRouteGuard';
import { FeatureKey } from '@/lib/featureKeys';

interface FeatureRouteGuardProps {
  /** Canonical feature key from FeatureKeys */
  featureKey: FeatureKey;
  /** Redirect path if access denied (default: '/upgrade') */
  redirectTo?: string;
  /** Children to render if access is granted */
  children: React.ReactNode;
  /** Loading component to show while checking */
  loadingComponent?: React.ReactNode;
  /** Component to show if access denied (before redirect) */
  deniedComponent?: React.ReactNode;
}

/**
 * Route guard component that protects pages based on feature access.
 * 
 * This component acts as a PURE LOGIC GATE:
 * - Blocks rendering while checking feature access (returns null)
 * - Allows rendering if feature access granted
 * - Denies rendering if feature access denied (shows redirect message)
 * 
 * IMPORTANT: This guard does NOT render a loading spinner.
 * The page-level authorization guard is responsible for showing loading UI.
 * This prevents duplicate loaders and ensures a single, centered spinner.
 * 
 * @example
 * ```tsx
 * export default function PurchasesPage() {
 *   return (
 *     <FeatureRouteGuard featureKey={FeatureKeys.PURCHASE_MANAGEMENT}>
 *       <PurchasesContent />
 *     </FeatureRouteGuard>
 *   );
 * }
 * ```
 */
export function FeatureRouteGuard({
  featureKey,
  redirectTo = '/upgrade',
  children,
  loadingComponent,
  deniedComponent,
}: FeatureRouteGuardProps) {
  const { hasAccess, loading, canRender } = useFeatureRouteGuard({
    featureKey,
    redirectTo,
  });

  // PURE LOGIC GATE: Block rendering silently while checking
  // Return empty fragment to block render completely (null can sometimes cause React hydration issues)
  // This prevents duplicate loaders and ensures single, centered spinner
  if (loading) {
    // If custom loadingComponent provided, respect it (for edge cases)
    // Otherwise, return empty fragment to block render silently
    return loadingComponent ? <>{loadingComponent}</> : <></>;
  }

  // Show denied state ONLY if check is complete (loading is false) and access is denied
  // Since loading is false, we know the check is complete
  if (!hasAccess && !canRender) {
    return (
      <>
        {deniedComponent || (
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <p className="text-gray-600 mb-4">Redirecting to upgrade page...</p>
            </div>
          </div>
        )}
      </>
    );
  }

  // Render children if access granted
  if (canRender) {
    return <>{children}</>;
  }

  // Fallback: Still loading (should not reach here if loading logic is correct)
  // Return empty fragment to block render silently
  return loadingComponent ? <>{loadingComponent}</> : <></>;
}
