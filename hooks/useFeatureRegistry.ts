import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface Feature {
  id: string;
  label: string;
  description?: string;
  icon_name?: string;
  route_path?: string;
  sort_order: number;
  is_addon?: boolean;
  enabled?: boolean; // Whether this feature is enabled for the current business
}

interface FeaturesByCategory {
  [category: string]: Feature[];
}

/**
 * Hook to fetch enabled features from Feature Registry
 * Falls back gracefully if registry is not available
 *
 * @deprecated For feature gating (e.g. sidebar locks), use useCapability() from @/hooks/useCapability.
 * This hook has no offline fallback. useCapability uses the capability snapshot.
 */
export function useFeatureRegistry() {
  const { business } = useAuth();
  const [featuresByCategory, setFeaturesByCategory] = useState<FeaturesByCategory>({});
  const [enabledIds, setEnabledIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'registry' | 'jsonb_fallback' | null>(null);

  // Fetch features function - wrapped in useCallback for stable reference
  const fetchFeatures = useCallback(async () => {
    if (!business?.id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(
        `/api/features/enabled?business_id=${business.id}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch features');
      }

      const data = await response.json();
      setFeaturesByCategory(data.features || {});
      setEnabledIds(data.enabledIds || []);
      setSource(data.source || null);
      
      // Debug logging (remove in production)
      if (process.env.NODE_ENV === 'development') {
        console.log('[FeatureRegistry] Source:', data.source);
        console.log('[FeatureRegistry] Enabled IDs:', data.enabledIds);
        console.log('[FeatureRegistry] Features by category:', Object.keys(data.features || {}));
        // Log specific feature status for debugging
        if (data.features?.sales) {
          const estimatesFeature = data.features.sales.find((f: any) => f.id === 'sales_estimates');
          if (estimatesFeature) {
            console.log('[FeatureRegistry] sales_estimates feature:', {
              id: estimatesFeature.id,
              enabled: estimatesFeature.enabled,
              inEnabledIds: data.enabledIds?.includes('sales_estimates')
            });
          }
        }
      }
    } catch (error) {
      console.error('Error fetching features:', error);
      setFeaturesByCategory({});
      setEnabledIds([]);
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  // Initial fetch on mount or businessId change
  useEffect(() => {
    if (business?.id) {
      fetchFeatures();
    } else {
      setLoading(false);
    }
  }, [business?.id, fetchFeatures]);

  // Listen for global feature registry updates
  // This allows Feature Matrix to trigger a refresh across all components
  useEffect(() => {
    const handleFeatureRegistryUpdate = (event?: CustomEvent) => {
      if (business?.id) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[FeatureRegistry] Received feature-registry-updated event', event?.detail);
        }
        // Small delay to ensure backend cache is cleared
        setTimeout(() => {
          if (process.env.NODE_ENV === 'development') {
            console.log('[FeatureRegistry] Refreshing features after event...');
          }
          fetchFeatures();
        }, 100);
      }
    };

    window.addEventListener('feature-registry-updated', handleFeatureRegistryUpdate as EventListener);
    
    return () => {
      window.removeEventListener('feature-registry-updated', handleFeatureRegistryUpdate as EventListener);
    };
  }, [business?.id, fetchFeatures]);


  /**
   * Check if a feature is enabled
   * Handles aliases and canonical key mappings (e.g., 'invoice_creation' -> 'sales_invoices')
   * This must match the mappings in lib/subscription/feature-access.ts
   */
  function hasFeature(featureId: string): boolean {
    // Direct check
    if (enabledIds.includes(featureId)) {
      return true;
    }
    
    // Handle canonical key to registry ID mappings
    // These mappings convert canonical keys (like 'invoice_creation') to registry IDs (like 'sales_invoices')
    const canonicalToRegistryMap: Record<string, string> = {
      'invoice_creation': 'sales_invoices',
      'estimates_quotations': 'sales_estimates',
      'credit_notes': 'sales_credit_notes',
      'recurring_invoices': 'sales_recurring_invoices',
      'sales_orders': 'sales_sales_orders',
      'supplier_management': 'purchase_suppliers',
      'expense_tracking': 'purchase_expenses',
      'inventory_adjustments': 'purchase_inventory_adjustments',
      'template_customization': 'settings_template_customization',
      'multi_user': 'settings_multi_user',
      'multi_branch': 'settings_multi_branch',
      'multi_warehouse': 'settings_multi_warehouse',
      'backup_restore': 'settings_backup',
      'settings_pos_mode': 'settings_pos_mode',
      'email_invoicing': 'integration_email',
      'payment_gateway': 'integration_payment_gateway',
      'api_access': 'integration_api',
      'ledger_accounting': 'advanced_ledger',
      'todo': 'tools_todo',
    };
    
    // Check canonical key mapping
    const registryId = canonicalToRegistryMap[featureId];
    if (registryId && enabledIds.includes(registryId)) {
      return true;
    }
    
    // Handle legacy aliases (for backward compatibility)
    const aliasMap: Record<string, string> = {
      'multi_warehouse': 'settings_multi_warehouse',
      'multi_branch': 'settings_multi_branch',
      'multi_user': 'settings_multi_user',
      'backup_restore': 'settings_backup',
      'pos_mode': 'settings_pos_mode',
    };
    
    const mappedId = aliasMap[featureId];
    if (mappedId && enabledIds.includes(mappedId)) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if a route is accessible (based on feature route_path)
   */
  function isRouteAccessible(routePath: string): boolean {
    if (!routePath) return true; // Allow routes without feature mapping
    
    // Check if any feature (enabled or disabled) has this route
    for (const features of Object.values(featuresByCategory)) {
      const feature = features.find(f => f.route_path === routePath);
      if (feature) {
        // Use enabled flag if available, otherwise fall back to hasFeature check
        return feature.enabled !== undefined ? feature.enabled : hasFeature(feature.id);
      }
    }
    
    // If route not found in registry, allow access (backward compatibility)
    return true;
  }

  /**
   * Get feature by route path (returns enabled/disabled status)
   * Handles sub-routes (e.g., /invoices/new matches /invoices)
   */
  function getFeatureByRoute(routePath: string): Feature | undefined {
    if (!routePath) return undefined;
    
    // First try exact match
    for (const features of Object.values(featuresByCategory)) {
      const feature = features.find(f => f.route_path === routePath);
      if (feature) {
        return feature;
      }
    }
    
    // If no exact match, try prefix matching (e.g., /invoices/new matches /invoices)
    // Sort by route length (longest first) to match most specific routes first
    const allFeatures: Feature[] = [];
    for (const features of Object.values(featuresByCategory)) {
      allFeatures.push(...features);
    }
    
    // Sort by route path length (longest first) for most specific match
    const sortedFeatures = allFeatures
      .filter(f => f.route_path && routePath.startsWith(f.route_path))
      .sort((a, b) => (b.route_path?.length || 0) - (a.route_path?.length || 0));
    
    return sortedFeatures[0];
  }

  /**
   * Get features for a specific category
   */
  function getFeaturesByCategory(category: string): Feature[] {
    return featuresByCategory[category] || [];
  }

  /**
   * Get all enabled feature IDs
   */
  function getEnabledFeatureIds(): string[] {
    return enabledIds;
  }

  return {
    featuresByCategory,
    enabledIds,
    loading,
    source,
    hasFeature,
    isRouteAccessible,
    getFeatureByRoute,
    getFeaturesByCategory,
    getEnabledFeatureIds,
    refresh: fetchFeatures
  };
}
