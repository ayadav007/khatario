/**
 * The More menu for one signed-in user, worked out on the server from `lib/more-navigation.ts`
 * so the Flutter phone app shows exactly what the website shows, with no copy of its own.
 */

import { evaluateCapabilityWithSnapshot, type CapabilityEvalSnapshot } from '@/lib/capability-eval';
import { buildMoreMenuSections, type MoreNavSection } from '@/lib/more-navigation';
import type { PlatformModule } from '@/lib/platform-modules';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import { getAllFeatureAccessForBusiness } from '@/lib/subscription/feature-access';
import { loadUserModulePermissions } from '@/lib/user-module-permissions';
import { queryOne } from '@/lib/db';
import { isSupplierHubVisible } from '@/lib/supplier-hub-visibility';

export type MoreMenuContextFlags = {
  isSupplier: boolean;
  warehousesEnabled: boolean;
  enabledModules: PlatformModule[];
  supplierHubVisible?: boolean;
};

/** Same checks the website's More page runs against the browser's capability snapshot. */
export function buildMoreMenuForSnapshot(
  snapshot: CapabilityEvalSnapshot,
  flags: MoreMenuContextFlags,
): MoreNavSection[] {
  const check = (resource: string, action?: string) =>
    evaluateCapabilityWithSnapshot(snapshot, {
      resource,
      action: action ?? 'view',
      // The snapshot already carries the role and permissions; there is no separate session copy here.
      sessionIsPrimaryAdmin: false,
      sessionPermissions: null,
    });
  return buildMoreMenuSections({
    ...flags,
    hasCapability: (resource, action) => check(resource, action).allowed,
    checkCapability: check,
  });
}

/** The website's supplier probe: some customer has approved this business as their supplier. */
async function isActiveSupplier(businessId: string): Promise<boolean> {
  const row = await queryOne<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM suppliers s
       WHERE s.linked_business_id = $1 AND s.allow_low_stock_access = true AND s.approval_status = 'approved'
     ) AS found`,
    [businessId],
  );
  return !!row?.found;
}

async function warehousesEnabled(businessId: string): Promise<boolean> {
  const row = await queryOne<{ warehouses_enabled: boolean | null }>(
    'SELECT warehouses_enabled FROM business_settings WHERE business_id = $1',
    [businessId],
  );
  return row?.warehouses_enabled === true;
}

export async function loadMoreMenuForUser(businessId: string, userId: string): Promise<MoreNavSection[]> {
  const [loaded, enabledFeatures, platform, supplier, warehouses, supplierHubVisible] = await Promise.all([
    loadUserModulePermissions(userId),
    getAllFeatureAccessForBusiness(businessId),
    getBusinessPlatformContext(businessId),
    isActiveSupplier(businessId).catch(() => false),
    warehousesEnabled(businessId).catch(() => false),
    isSupplierHubVisible().catch(() => false),
  ]);
  if (!loaded) return [];
  return buildMoreMenuForSnapshot(
    { permissions: loaded.permissions, isPrimaryAdmin: loaded.isPrimaryAdmin, enabledFeatures: Array.from(enabledFeatures) },
    {
      isSupplier: supplier,
      warehousesEnabled: warehouses,
      enabledModules: platform.enabledModules,
      supplierHubVisible,
    },
  );
}
