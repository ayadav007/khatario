/**
 * Pure capability evaluation (client snapshot) — used by hooks and guards.
 * Distinguishes subscription/plan denial vs role permission denial.
 */

import { loadCapabilitySnapshot } from '@/lib/capability-snapshot';
import {
  normalizeModule,
  normalizeFeature,
  normalizeAction,
} from '@/lib/capability-normalizer';
import { getHrPlanFeatureForCapabilityCheck } from '@/lib/hr-plan-features';

function hasAddonFeature(
  addons: { addon_type: string; status: string; end_date?: string }[] | undefined,
  addonType: string
): boolean {
  if (!Array.isArray(addons) || addons.length === 0) return false;
  return addons.some(
    (a) =>
      a.addon_type === addonType &&
      a.status === 'active' &&
      (!a.end_date || new Date(a.end_date) >= new Date())
  );
}

export type CapabilityDenialReason = 'FEATURE_NOT_IN_PLAN' | 'PERMISSION_DENIED';

export interface CapabilityEvalInput {
  resource: string;
  action?: string;
  businessId: string;
  userId: string;
  sessionIsPrimaryAdmin: boolean;
  sessionPermissions: Record<string, Record<string, boolean>> | undefined | null;
}

/**
 * @returns allowed + when false, whether the user’s plan lacks the feature vs lacks role permission.
 */
export function evaluateCapabilityAccess(
  input: CapabilityEvalInput
): { allowed: boolean; denialReason?: CapabilityDenialReason } {
  const {
    resource: res,
    action,
    businessId,
    userId,
    sessionIsPrimaryAdmin,
    sessionPermissions,
  } = input;

  if (!businessId || !userId) {
    return { allowed: false, denialReason: 'PERMISSION_DENIED' };
  }

  const snapshot = loadCapabilitySnapshot(businessId, userId);

  const hrPlanFeature = getHrPlanFeatureForCapabilityCheck(res);
  if (hrPlanFeature) {
    if (!snapshot?.enabledFeatures?.includes(hrPlanFeature)) {
      return { allowed: false, denialReason: 'FEATURE_NOT_IN_PLAN' };
    }
  }

  if (sessionIsPrimaryAdmin) return { allowed: true };
  if (snapshot?.isPrimaryAdmin) return { allowed: true };

  const mergedPermissions = {
    ...(sessionPermissions || {}),
    ...(snapshot?.permissions || {}),
  } as Record<string, Record<string, boolean>>;

  if (!snapshot && Object.keys(mergedPermissions).length === 0) {
    return { allowed: false, denialReason: 'PERMISSION_DENIED' };
  }

  const canonicalModule = normalizeModule(res);
  const canonicalAction = normalizeAction(action || 'view');
  const featureRegistryId = normalizeFeature(res);

  if (
    featureRegistryId === 'integration_whatsapp_bot' ||
    featureRegistryId === 'whatsapp_send_message' ||
    featureRegistryId === 'whatsapp_manual'
  ) {
    if (hasAddonFeature(snapshot?.addons || [], 'whatsapp_bot')) {
      return { allowed: true };
    }
  }

  const modulePerms = mergedPermissions[canonicalModule];
  if (modulePerms) {
    const permKey = `can_${canonicalAction}` as keyof typeof modulePerms;
    if (modulePerms[permKey]) return { allowed: true };
  }

  if (snapshot?.enabledFeatures?.includes(featureRegistryId)) {
    return { allowed: true };
  }

  if (hrPlanFeature) {
    return { allowed: false, denialReason: 'PERMISSION_DENIED' };
  }

  const featureInPlan = snapshot?.enabledFeatures?.includes(featureRegistryId);
  if (!featureInPlan) {
    return { allowed: false, denialReason: 'FEATURE_NOT_IN_PLAN' };
  }

  return { allowed: false, denialReason: 'PERMISSION_DENIED' };
}
