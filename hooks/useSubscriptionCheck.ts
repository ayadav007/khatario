/**
 * Custom hook to check subscription limits and features
 *
 * @deprecated Use useCapability() from @/hooks/useCapability for feature checks.
 * This hook has no offline fallback. useCapability uses the capability snapshot.
 *
 * Legacy: useFeatureRegistry() for feature checks, /api/subscriptions/check-limit for limit checks.
 */

import { useState, useEffect } from 'react';

interface LimitCheck {
  allowed: boolean;
  current: number;
  limit: number;
  message?: string;
}

export function useSubscriptionCheck(businessId: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<any>(null);
  const [enabledFeatures, setEnabledFeatures] = useState<string[]>([]);
  const [featuresLoading, setFeaturesLoading] = useState(true);

  useEffect(() => {
    if (businessId) {
      fetchSubscription();
      // Don't fetch features here - wait for subscription to be available
      // This prevents double-fetching and ensures we have complete data
    }
  }, [businessId]);

  async function fetchSubscription() {
    try {
      const response = await fetch(`/api/subscriptions/current?business_id=${businessId}`);
      if (response.ok) {
        const data = await response.json();
        setSubscription(data.subscription);
      }
    } catch (error) {
      console.error('Error fetching subscription:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchEnabledFeatures() {
    if (!businessId) {
      setFeaturesLoading(false);
      return;
    }
    
    try {
      setFeaturesLoading(true);
      // Try Feature Registry first (new system)
      const response = await fetch(`/api/features/enabled?business_id=${businessId}`);
      if (response.ok) {
        const data = await response.json();
        setEnabledFeatures(data.enabledIds || []);
        setFeaturesLoading(false);
        return;
      }
    } catch (error) {
      console.warn('[SubscriptionCheck] Feature Registry not available:', error);
    }

    setEnabledFeatures([]);
    setFeaturesLoading(false);
  }

  // Fetch features ONLY when subscription is available
  // This ensures we have complete data and prevents double-fetching
  useEffect(() => {
    if (subscription) {
      fetchEnabledFeatures();
    } else if (!loading && businessId) {
      // If subscription fetch completed but subscription is null, mark features as loaded
      // This prevents infinite loading state
      setFeaturesLoading(false);
    }
  }, [subscription, loading, businessId]);

  async function checkLimit(
    limitType: 'invoices' | 'customers' | 'items' | 'users' | 'whatsapp'
  ): Promise<LimitCheck> {
    if (!businessId) {
      return { allowed: false, current: 0, limit: 0 };
    }

    try {
      // Call backend API for accurate limit checking
      const response = await fetch(
        `/api/subscriptions/check-limit?business_id=${businessId}&limit_type=${limitType}`
      );
      if (response.ok) {
        const data = await response.json();
        return data;
      }
      
      // Fallback to subscription data if API fails
      if (!subscription) {
        return { allowed: false, current: 0, limit: 0 };
      }

      const limits = subscription.features?.limits;
      if (!limits) {
        return { allowed: false, current: 0, limit: 0 };
      }

      const limitValue = limits[`max_${limitType}_per_month`] || limits[`max_${limitType}`];
      
      // -1 means unlimited
      if (limitValue === -1) {
        return { allowed: true, current: 0, limit: -1 };
      }

      return { allowed: true, current: 0, limit: limitValue };
    } catch (error) {
      console.error('Error checking limit:', error);
      return { allowed: false, current: 0, limit: 0 };
    }
  }

  const [addons, setAddons] = useState<any[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(true);

  useEffect(() => {
    if (businessId) {
      fetchAddons();
    }
  }, [businessId]);

  async function fetchAddons() {
    if (!businessId) return;
    setAddonsLoading(true);
    try {
      const response = await fetch(`/api/subscriptions/addons/current?business_id=${businessId}`);
      if (response.ok) {
        const data = await response.json();
        const fetchedAddons = Array.isArray(data.addons) ? data.addons : [];
        setAddons(fetchedAddons);
        console.log('[SubscriptionCheck] Fetched addons:', fetchedAddons);
      }
    } catch (error) {
      console.error('Error fetching addons:', error);
      setAddons([]);
    } finally {
      setAddonsLoading(false);
    }
  }

  /**
   * Check if a feature is enabled
   * 
   * Handles:
   * 1. Addon-based features (WhatsApp and future addons)
   * 2. Feature Registry (new system)
   * 3. JSONB fallback (legacy)
   */
  function hasFeature(featureKey: string): boolean {
    // Helper: Check if addon is active
    const hasActiveAddon = (addonType: string): boolean => {
      if (!Array.isArray(addons) || addons.length === 0) {
        return false;
      }
      return addons.some(a => 
        a.addon_type === addonType && 
        a.status === 'active' &&
        (!a.end_date || new Date(a.end_date) >= new Date())
      );
    };

    // ALL addon-based feature keys (current and legacy)
    const addonFeatureMap: Record<string, string> = {
      // Legacy keys
      'whatsapp_bot': 'whatsapp_bot',
      'whatsapp_send_message': 'whatsapp_bot', // Both WhatsApp features use whatsapp_bot addon
      
      // Feature Registry keys
      'integration_whatsapp_bot': 'whatsapp_bot',
      'integration_whatsapp_manual': 'whatsapp_bot',
    };

    // Check if this is an addon-based feature
    const addonType = addonFeatureMap[featureKey];
    if (addonType) {
      return hasActiveAddon(addonType);
    }

    // Map legacy feature keys to Feature Registry IDs
    const featureKeyMapping: Record<string, string> = {
      'todo': 'tools_todo', // Map 'todo' to 'tools_todo' in registry
    };
    const registryFeatureKey = featureKeyMapping[featureKey] || featureKey;

    // For plan-based features: Use Feature Registry if available
    const hasInRegistry = enabledFeatures.includes(registryFeatureKey);
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[SubscriptionCheck] hasFeature('${featureKey}' -> '${registryFeatureKey}'):`,
        hasInRegistry
      );
    }
    return hasInRegistry;
  }

  return {
    loading: loading || addonsLoading || featuresLoading,
    subscription,
    addons,
    enabledFeatures, // Expose enabled features for debugging
    // Expose loading states separately so guard can track feature data stability
    featuresLoading,
    addonsLoading,
    checkLimit,
    hasFeature,
    refreshAddons: fetchAddons,
    refreshFeatures: fetchEnabledFeatures,
  };
}

