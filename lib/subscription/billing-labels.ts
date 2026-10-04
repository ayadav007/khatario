import { PLATFORM_MODULE_LABELS, normalizePlatformModule, type PlatformModule } from '@/lib/platform-modules';

export const BILLING_CYCLE_LABELS: Record<string, string> = {
  monthly: 'monthly',
  yearly: 'yearly',
  three_year: '3 years',
};

export function moduleLabelForKey(moduleKey: string | null | undefined): string {
  const mod = normalizePlatformModule(moduleKey);
  if (mod) return PLATFORM_MODULE_LABELS[mod];
  return 'Subscription';
}

export function formatModulePlanReceiptLabel(
  moduleKey: string | null | undefined,
  planDisplayName: string,
  billingCycle?: string | null,
): string {
  const product = moduleLabelForKey(moduleKey);
  const cycle = billingCycle ? BILLING_CYCLE_LABELS[billingCycle] ?? null : null;
  if (cycle) {
    return `${product} — ${planDisplayName} (${cycle})`;
  }
  return `${product} — ${planDisplayName}`;
}

export function productLineToModuleKey(productLine: string | null | undefined): PlatformModule {
  if (productLine === 'hr') return 'hr';
  if (productLine === 'connect') return 'connect';
  return 'billing';
}
