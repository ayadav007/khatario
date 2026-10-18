/**
 * The HR menu section for one signed-in user, worked out on the server so every app
 * (the website and the Flutter phone app) shows the same items from one list.
 */

import { evaluateCapabilityWithSnapshot, type CapabilityEvalSnapshot } from '@/lib/capability-eval';
import { buildHrNavSection, type HrNavSection } from '@/lib/hr/hr-admin-nav';
import type { PlatformModule } from '@/lib/platform-modules';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import { getAllFeatureAccessForBusiness } from '@/lib/subscription/feature-access';
import { loadUserModulePermissions } from '@/lib/user-module-permissions';

/** Same checks the website's More menu and Sidebar run against the browser's capability snapshot. */
export function buildHrNavSectionForSnapshot(
  snapshot: CapabilityEvalSnapshot,
  enabledModules: PlatformModule[],
): HrNavSection | null {
  const check = (resource: string) =>
    evaluateCapabilityWithSnapshot(snapshot, {
      resource,
      action: 'view',
      // The snapshot already carries the role and permissions; there is no separate session copy here.
      sessionIsPrimaryAdmin: false,
      sessionPermissions: null,
    });
  return buildHrNavSection({
    hasFeature: (featureKey) => check(featureKey).allowed,
    roleAllowsModule: (moduleKey) => {
      const result = check(moduleKey);
      return result.allowed || result.denialReason === 'FEATURE_NOT_IN_PLAN';
    },
    enabledModules,
  });
}

export async function loadHrNavSectionForUser(
  businessId: string,
  userId: string,
): Promise<HrNavSection | null> {
  const [loaded, enabledFeatures, platform] = await Promise.all([
    loadUserModulePermissions(userId),
    getAllFeatureAccessForBusiness(businessId),
    getBusinessPlatformContext(businessId),
  ]);
  if (!loaded) return null;
  return buildHrNavSectionForSnapshot(
    { permissions: loaded.permissions, isPrimaryAdmin: loaded.isPrimaryAdmin, enabledFeatures: Array.from(enabledFeatures) },
    platform.enabledModules,
  );
}
