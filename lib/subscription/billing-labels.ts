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

/** Connect's `max_users` is its own WhatsApp agent pool, separate from Billing users. */
export function connectSeatsLabel(maxUsers: number | null | undefined): string {
  if (maxUsers === -1) return 'Unlimited WhatsApp agents';
  if (maxUsers && maxUsers > 0) {
    return maxUsers === 1 ? '1 WhatsApp agent' : `Up to ${maxUsers} WhatsApp agents`;
  }
  return 'WhatsApp agents not included';
}

export function productLineToModuleKey(productLine: string | null | undefined): PlatformModule {
  if (productLine === 'hr') return 'hr';
  if (productLine === 'connect') return 'connect';
  return 'billing';
}
