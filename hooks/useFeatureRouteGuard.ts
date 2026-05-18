'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionCheck } from './useSubscriptionCheck';
import { FeatureKeys, normalizeFeatureKey } from '@/lib/featureKeys';

interface UseFeatureRouteGuardOptions {
  /** Canonical feature key from FeatureKeys */
  featureKey: string;
  /** Redirect path if access denied (default: '/upgrade') */
  redirectTo?: string;
  /** Whether to skip the check (e.g., if business/user not loaded yet) */
  skipCheck?: boolean;
}

interface UseFeatureRouteGuardResult {
  /** Whether user has access to the feature */
  hasAccess: boolean;
  /** Whether the check is still loading */
  loading: boolean;
  /** Whether to show the page content */
  canRender: boolean;
}

/**
 * Route guard hook that checks feature access before rendering a page.
 * 
 * This hook:
 * - Checks if the business has access to the required feature
 * - Redirects to upgrade page if access is denied
 * - Returns loading state to prevent page flash
 * 
 * @example
 * ```tsx
 * function PurchasesPage() {
 *   const { hasAccess, loading, canRender } = useFeatureRouteGuard({
 *     featureKey: FeatureKeys.PURCHASE_MANAGEMENT,
 *   });
 * 
 *   if (loading) return <LoadingSpinner />;
 *   if (!canRender) return null; // Redirecting...
 * 
 *   return <div>Purchases Page</div>;
 * }
 * ```
 */
export function useFeatureRouteGuard({
  featureKey,
  redirectTo = '/upgrade',
  skipCheck = false,
}: UseFeatureRouteGuardOptions): UseFeatureRouteGuardResult {
  const { business, user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { 
    hasFeature, 
    loading: subscriptionLoading,
    enabledFeatures,
    addons,
    featuresLoading,
    addonsLoading,
  } = useSubscriptionCheck(business?.id);
  const [hasAccess, setHasAccess] = useState<boolean>(false);
  const [checkComplete, setCheckComplete] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Normalize feature key to canonical form
  const canonicalKey = normalizeFeatureKey(featureKey);

  useEffect(() => {
    // Skip check if explicitly requested
    if (skipCheck) {
      setCheckComplete(false);
      return;
    }

    // Wait for auth to load (business and user must be available)
    if (authLoading || !business?.id || !user?.id) {
      setCheckComplete(false);
      return;
    }

    // Wait for ALL subscription data to load (subscription, features, addons)
    // This ensures hasFeature() has stable data to evaluate
    if (subscriptionLoading || featuresLoading || addonsLoading) {
      setCheckComplete(false);
      return;
    }

    // All prerequisites met AND feature data is stable - perform feature check
    const access = hasFeature(canonicalKey);
    setHasAccess(access);
    setCheckComplete(true);

    // If access is granted, cancel any pending redirect
    if (access) {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
        redirectTimeoutRef.current = null;
      }
      if (redirecting) {
        setRedirecting(false);
      }
      return;
    }

    // Redirect if access denied (only if not already redirecting)
    if (!access && !redirecting) {
      setRedirecting(true);
      // Small delay to prevent flash
      redirectTimeoutRef.current = setTimeout(() => {
        router.push(redirectTo);
        redirectTimeoutRef.current = null;
      }, 100);
    }
  }, [
    business?.id,
    user?.id,
    authLoading,
    subscriptionLoading,
    featuresLoading,
    addonsLoading,
    canonicalKey,
    hasFeature,
    redirectTo,
    router,
    skipCheck,
    redirecting,
    // Include enabledFeatures and addons in deps to re-check when they change
    // This ensures guard reacts to feature data updates
    enabledFeatures,
    addons,
  ]);

  // Cleanup redirect timeout on unmount
  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  // Loading = auth loading OR subscription loading OR check not complete yet
  const loading = authLoading || subscriptionLoading || !checkComplete;
  // Can render = check complete AND has access AND not redirecting
  const canRender = checkComplete && hasAccess && !redirecting;

  return {
    hasAccess,
    loading,
    canRender,
  };
}
