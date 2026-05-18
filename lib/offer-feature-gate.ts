/**
 * Plan gating for invoice promotion types (offer-engine).
 *
 * Runtime enforcement uses enabled registry ids from the subscription matrix
 * ({@link getEnabledFeatures}) plus {@link loadKnownPromotionRegistryIds}.
 * For upgrade / marketing copy when a promotion flavor is locked, use
 * {@link getFeatureAccessInfo} via {@link getOfferTypeFeatureAccessInfo}.
 */

import { queryRows } from '@/lib/db';
import { FeatureKeys } from '@/lib/featureKeys';
import { resolveRegistryFeatureId } from '@/lib/subscription/feature-access';
import {
  getFeatureAccessInfo,
  type FeatureAccessInfo,
} from '@/lib/subscription/feature-access-info';

/** Registry feature id used in subscription_plan_features / platform_features */
export function registryIdForOfferType(offerType: string): string | null {
  const t = (offerType || '').toLowerCase();
  switch (t) {
    case 'percentage_discount':
    case 'percent_discount':
      return resolveRegistryFeatureId(FeatureKeys.OFFERS_PERCENT_DISCOUNT);
    case 'flat_discount':
      return resolveRegistryFeatureId(FeatureKeys.OFFERS_FLAT_DISCOUNT);
    case 'buy_x_get_y':
      return resolveRegistryFeatureId(FeatureKeys.OFFERS_BOGO);
    case 'bill_value_discount':
      return resolveRegistryFeatureId(FeatureKeys.OFFERS_BILL_VALUE);
    default:
      return null;
  }
}

/**
 * If `regId` is not present in platform_features, the promotion type is treated as allowed
 * (backward compatible until registry rows are seeded).
 */
export function isOfferTypeAllowedForBusiness(
  offerType: string,
  enabledRegistryIds: readonly string[],
  knownRegistryIdSet: ReadonlySet<string>
): boolean {
  const regId = registryIdForOfferType(offerType);
  if (regId == null) return true;
  if (!knownRegistryIdSet.has(regId)) return true;
  return enabledRegistryIds.includes(regId);
}

export async function loadKnownPromotionRegistryIds(): Promise<ReadonlySet<string>> {
  try {
    const rows = await queryRows<{ id: string }>(
      `SELECT id FROM platform_features WHERE is_active = true`
    );
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set<string>();
  }
}

/** Wraps {@link getFeatureAccessInfo} for the registry id mapped from offer `type`. Custom types return empty plans. */
export async function getOfferTypeFeatureAccessInfo(offerType: string): Promise<FeatureAccessInfo> {
  const id = registryIdForOfferType(offerType);
  if (!id) {
    return {
      registryFeatureId: '',
      planLabel: null,
      lowestPlan: null,
      allPlans: [],
    };
  }
  return getFeatureAccessInfo(id);
}
