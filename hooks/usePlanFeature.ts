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
  const alias: Record<string, string> = {
    pos_mode: 'settings_pos_mode',
    debit_notes: 'sales_debit_notes',
    credit_notes: 'sales_credit_notes',
    invoice_creation: 'sales_invoices',
    estimates_quotations: 'sales_estimates',
    recurring_invoices: 'sales_recurring_invoices',
    sales_orders: 'sales_sales_orders',
    template_customization: 'settings_template_customization',
  };
  const resolved = alias[featureId] ?? featureId;
  return enabledFeatureIds.includes(featureId) || enabledFeatureIds.includes(resolved);
}
