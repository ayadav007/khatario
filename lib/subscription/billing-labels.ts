import { PLATFORM_MODULE_LABELS, normalizePlatformModule, type PlatformModule } from '@/lib/platform-modules';

export function moduleLabelForKey(moduleKey: string | null | undefined): string {
  const mod = normalizePlatformModule(moduleKey);
  if (mod) return PLATFORM_MODULE_LABELS[mod];
  return 'Subscription';
}

export function formatModulePlanReceiptLabel(
  moduleKey: string | null | undefined,
  planDisplayName: string,
  billingCycle?: 'monthly' | 'yearly' | string | null,
): string {
  const product = moduleLabelForKey(moduleKey);
  const cycle =
    billingCycle === 'yearly' ? 'yearly' : billingCycle === 'monthly' ? 'monthly' : null;
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
