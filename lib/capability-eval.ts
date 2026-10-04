/**
 * Pure capability evaluation (client snapshot) — used by hooks and guards.
 * Distinguishes subscription/plan denial vs role permission denial.
 */

import { loadCapabilitySnapshot } from '@/lib/capability-snapshot';
import {
  FEATURE_ALIAS_MAP,
  FEATURE_REGISTRY_IDS,
  normalizeFeature,
  normalizeAction,
  resolvePermissionModuleKeys,
  type PermissionAction,
} from '@/lib/capability-normalizer';

/** Stored role flag for each canonical action, plus legacy key names. */
const ACTION_FLAGS: Record<PermissionAction, string[]> = {
  read: ['can_view', 'can_read'],
  create: ['can_add', 'can_create'],
  update: ['can_modify', 'can_update'],
  delete: ['can_delete'],
  export: ['can_share', 'can_export'],
};

function planFeatureForModule(resource: string): string | null {
  if (Object.prototype.hasOwnProperty.call(FEATURE_ALIAS_MAP, resource)) {
    return FEATURE_ALIAS_MAP[resource];
  }
  if ((FEATURE_REGISTRY_IDS as readonly string[]).includes(resource)) return resource;
  return null;
}
import { getHrPlanFeatureForCapabilityCheck } from '@/lib/hr-plan-features';

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
): { allowed: boolean; denialReason?: CapabilityDenialReason; indeterminate?: boolean } {
  const {
    resource: res,
    action,
    businessId,
    userId,
    sessionIsPrimaryAdmin,
    sessionPermissions,
  } = input;

  if (!businessId || !userId) {
    return { allowed: false, indeterminate: true };
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

  // No snapshot and no session perms yet — unknown, not a real deny (avoids flashing Access Denied).
  if (!snapshot && Object.keys(mergedPermissions).length === 0) {
    return { allowed: false, indeterminate: true };
  }

  const canonicalAction = normalizeAction(action || 'view');
  const moduleKeys = resolvePermissionModuleKeys(res);

  // Role-permission module: the role must hold the flag; the plan can only take access away.
  if (moduleKeys.length > 0) {
    const flags = ACTION_FLAGS[canonicalAction];
    const granted = moduleKeys.some((key) => {
      const perms = mergedPermissions[key];
      return !!perms && flags.some((flag) => perms[flag] === true);
    });
    if (!granted) return { allowed: false, denialReason: 'PERMISSION_DENIED' };
    const planFeature = planFeatureForModule(res);
    const enabledFeatures = snapshot?.enabledFeatures;
    if (planFeature && Array.isArray(enabledFeatures) && !enabledFeatures.includes(planFeature)) {
      return { allowed: false, denialReason: 'FEATURE_NOT_IN_PLAN' };
    }
    return { allowed: true };
  }

  const normalized = normalizeFeature(res);
  const featureRegistryId =
    normalized === 'whatsapp_send_message' || normalized === 'whatsapp_manual'
      ? 'integration_whatsapp_manual'
      : normalized;

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
