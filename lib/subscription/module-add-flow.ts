import { MODULE_ADD_CONFIG } from '@/lib/subscription/module-entitlements';
import type { PlatformModule } from '@/lib/platform-modules';

/** Default starter/trial plan id when adding a product module via checkout. */
export function getModuleAddPlanId(moduleKey: PlatformModule): string | null {
  if (moduleKey === 'crm') return null;
  return MODULE_ADD_CONFIG[moduleKey]?.trialPlanId ?? null;
}

export const MODULE_REQUIRES_CHECKOUT_CODE = 'MODULE_REQUIRES_CHECKOUT' as const;
