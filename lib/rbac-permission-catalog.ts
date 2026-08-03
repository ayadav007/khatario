/**
 * RBAC permission catalog — lists assignable module actions for the roles UI.
 * Source of truth: permission_modules + role_permissions (module_key booleans).
 * Do not rely on the legacy `permissions` table (migration 059 artifact).
 */

import type { PlatformModule } from '@/lib/platform-modules';

export const RBAC_STANDARD_ACTIONS = [
  { key: 'read', name: 'Read', flag: 'can_view' as const },
  { key: 'create', name: 'Create', flag: 'can_add' as const },
  { key: 'update', name: 'Update', flag: 'can_modify' as const },
  { key: 'delete', name: 'Delete', flag: 'can_delete' as const },
  { key: 'export', name: 'Export', flag: 'can_share' as const },
];

export type RbacCatalogPermission = {
  id: string;
  permission_key: string;
  permission_name: string;
  module_key: string;
  module_name: string;
  display_order: number;
};

export type PermissionModuleRow = {
  module_key: string;
  module_name: string;
  display_order: number | null;
};

/** RBAC module_key → owning platform module. Omit or `core` = always show in roles UI. */
export const PERMISSION_MODULE_PLATFORM: Record<string, PlatformModule | 'core'> = {
  dashboard: 'billing',
  settings: 'core',
  tools: 'core',

  invoices: 'billing',
  credit_notes: 'billing',
  debit_notes: 'billing',
  customers: 'billing',
  purchases: 'billing',
  purchase_returns: 'billing',
  suppliers: 'billing',
  items: 'billing',
  payments: 'billing',
  expenses: 'billing',
  warehouses: 'billing',
  warehouse_transfer: 'billing',
  inventory_adjustment: 'billing',
  reports: 'billing',
  report: 'billing',
  'report.financial': 'billing',
  'report.gst': 'billing',
  'report.inventory': 'billing',
  journal: 'billing',
  accounting_period: 'billing',
  work_orders: 'billing',

  employees: 'hr',
  attendance: 'hr',
  leaves: 'hr',
  leave_requests: 'hr',
  payroll: 'hr',
  recruitment: 'hr',
  commissions: 'hr',
  hr: 'hr',

  whatsapp: 'connect',
};

/** Normalize authorize() module keys to RBAC catalog keys before platform lookup. */
const AUTH_MODULE_ALIASES: Record<string, string> = {
  inventory_adjustment: 'items',
  inventory_adjustments: 'items',
  warehouse: 'warehouses',
  warehouses: 'warehouses',
  warehouse_transfer: 'warehouse_transfer',
  warehouse_transfers: 'warehouse_transfer',
  stock_transfer: 'warehouse_transfer',
  stock_transfers: 'warehouse_transfer',
  report: 'reports',
  'report.financial': 'reports',
  'report.inventory': 'reports',
  'report.gst': 'reports',
  hr: 'employees',
  invoice: 'invoices',
  customer: 'customers',
  item: 'items',
  purchase: 'purchases',
  supplier: 'suppliers',
  employee: 'employees',
};

export function resolvePlatformModuleForAuthModule(
  authModuleKey: string,
): PlatformModule | 'core' | null {
  const normalized = AUTH_MODULE_ALIASES[authModuleKey] ?? authModuleKey;
  return PERMISSION_MODULE_PLATFORM[normalized] ?? null;
}

export function isRbacModuleVisibleForPlatform(
  moduleKey: string,
  enabledModules: PlatformModule[],
): boolean {
  const owner = PERMISSION_MODULE_PLATFORM[moduleKey];
  if (!owner || owner === 'core') return true;
  return enabledModules.includes(owner);
}

export function buildRbacCatalogFromModules(
  modules: PermissionModuleRow[],
  enabledModules?: PlatformModule[],
): RbacCatalogPermission[] {
  const filtered = enabledModules?.length
    ? modules.filter((m) => isRbacModuleVisibleForPlatform(m.module_key, enabledModules))
    : modules;

  const sorted = [...filtered].sort((a, b) => {
    const ao = a.display_order ?? 999;
    const bo = b.display_order ?? 999;
    if (ao !== bo) return ao - bo;
    return a.module_name.localeCompare(b.module_name);
  });

  const out: RbacCatalogPermission[] = [];
  for (const mod of sorted) {
    const order = mod.display_order ?? 999;
    for (const action of RBAC_STANDARD_ACTIONS) {
      out.push({
        id: `${mod.module_key}_${action.key}`,
        permission_key: action.key,
        permission_name: action.name,
        module_key: mod.module_key,
        module_name: mod.module_name,
        display_order: order,
      });
    }
  }
  return out;
}

export function parseSyntheticPermissionId(permissionId: string): {
  moduleKey: string;
  action: string;
} | null {
  const knownActions = RBAC_STANDARD_ACTIONS.map((a) => a.key);
  for (const action of knownActions) {
    const suffix = `_${action}`;
    if (permissionId.endsWith(suffix)) {
      return {
        moduleKey: permissionId.slice(0, -suffix.length),
        action,
      };
    }
  }
  return null;
}

export type RbacPermissionFlag =
  (typeof RBAC_STANDARD_ACTIONS)[number]['flag'];

export function actionToFlag(action: string): RbacPermissionFlag | null {
  const found = RBAC_STANDARD_ACTIONS.find((a) => a.key === action);
  return found ? found.flag : null;
}
