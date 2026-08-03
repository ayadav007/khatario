/**
 * Per-module subscription entitlements: which module owns limits/features,
 * and how account-wide limits (e.g. console seats) combine across modules.
 */

import type { PlatformModule } from '@/lib/platform-modules';
import { FeatureKeys, normalizeFeatureKey } from '@/lib/featureKeys';
import type { LimitCheckType } from '@/lib/subscription/limit-registry';

function resolveRegistryFeatureId(canonicalKey: string): string {
  const registryMapping: Record<string, string> = {
    [FeatureKeys.TODO]: 'tools_todo',
    [FeatureKeys.TEMPLATE_CUSTOMIZATION]: 'settings_template_customization',
    [FeatureKeys.INVOICE_CREATION]: 'sales_invoices',
    [FeatureKeys.ESTIMATES_QUOTATIONS]: 'sales_estimates',
    [FeatureKeys.CREDIT_NOTES]: 'sales_credit_notes',
    [FeatureKeys.MULTI_USER]: 'settings_multi_user',
  };
  return registryMapping[canonicalKey] || canonicalKey;
}

/** Limits enforced only when the owning module is enabled + subscribed. */
export const LIMIT_OWNER_MODULE: Partial<Record<LimitCheckType, PlatformModule>> = {
  invoices: 'billing',
  customers: 'billing',
  items: 'billing',
  suppliers: 'billing',
  purchases: 'billing',
  expenses: 'billing',
  estimates: 'billing',
  credit_notes: 'billing',
  sales_orders: 'billing',
  purchase_orders: 'billing',
  employees: 'hr',
  attendance: 'hr',
  leave_requests: 'hr',
  payroll: 'hr',
  departments: 'hr',
  salary_advances: 'hr',
  employee_expenses: 'hr',
  commissions: 'hr',
  employee_tasks: 'hr',
  holidays: 'hr',
  shifts: 'hr',
  designations: 'hr',
  performance_reviews: 'hr',
  whatsapp: 'connect',
  email: 'billing',
  branches: 'billing',
};

/** Account-wide: MAX console seats across active module plans (not SUM). */
export const ACCOUNT_WIDE_LIMIT_TYPES = new Set<LimitCheckType>(['users']);

export const CORE_BILLING_FEATURE_KEYS = new Set([
  'customer_management',
  'item_management',
  'stock_tracking',
  'payment_tracking',
]);

export function isAccountWideLimit(limitType: LimitCheckType): boolean {
  return ACCOUNT_WIDE_LIMIT_TYPES.has(limitType);
}

export function getLimitOwnerModule(limitType: LimitCheckType): PlatformModule | null {
  return LIMIT_OWNER_MODULE[limitType] ?? null;
}

/**
 * Which product module must be enabled for a registry/canonical feature.
 * `null` = shared (any active module subscription is enough).
 */
export function getFeatureRequiredModule(featureKey: string): PlatformModule | null {
  const canonical = normalizeFeatureKey(featureKey);
  const registryId = resolveRegistryFeatureId(canonical);

  if (CORE_BILLING_FEATURE_KEYS.has(canonical) || CORE_BILLING_FEATURE_KEYS.has(registryId)) {
    return 'billing';
  }
  if (registryId.startsWith('hr_')) return 'hr';
  if (
    registryId.startsWith('sales_') ||
    registryId.startsWith('purchase_') ||
    registryId.startsWith('inventory_') ||
    registryId.startsWith('accounting_') ||
    registryId.startsWith('reports_') ||
    registryId.startsWith('advanced_') ||
    registryId.startsWith('offers_') ||
    registryId.startsWith('tools_') ||
    registryId.startsWith('integration_email') ||
    registryId.startsWith('integration_payment')
  ) {
    return 'billing';
  }
  if (registryId.includes('whatsapp') || registryId.startsWith('integration_whatsapp')) {
    return 'connect';
  }
  return null;
}

export const MODULE_ADD_CONFIG: Record<
  Exclude<PlatformModule, 'crm'>,
  { trialPlanId: string; trialDays: number | null; status: 'trial' | 'active'; label: string; description: string }
> = {
  billing: {
    trialPlanId: 'trial',
    trialDays: 30,
    status: 'trial',
    label: 'Billing',
    description: 'GST invoicing, inventory, purchases, and reports.',
  },
  hr: {
    trialPlanId: 'hr_trial',
    trialDays: 30,
    status: 'trial',
    label: 'HR',
    description: 'Employees, attendance, payroll, and leave.',
  },
  connect: {
    trialPlanId: 'connect',
    trialDays: null,
    status: 'active',
    label: 'Connect',
    description: 'WhatsApp inbox, bot, and customer messaging.',
  },
};
