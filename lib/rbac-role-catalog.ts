/**
 * System preset roles → platform module ownership.
 * Custom roles (no preset key) are always shown.
 */

import type { PlatformModule } from '@/lib/platform-modules';

export const SYSTEM_ROLE_PLATFORM: Record<string, PlatformModule | 'core'> = {
  primary_admin: 'core',
  sales: 'billing',
  accountant: 'billing',
  inventory_manager: 'billing',
  hr_admin: 'hr',
  team_lead: 'hr',
  payroll_clerk: 'hr',
};

const BILLING_ROLE_KEYS = new Set(['sales', 'accountant', 'inventory_manager']);
const HR_ROLE_KEYS = new Set(['hr_admin', 'team_lead', 'payroll_clerk']);

export function isSystemRoleVisibleForModules(
  roleKey: string,
  enabledModules: PlatformModule[],
): boolean {
  const owner = SYSTEM_ROLE_PLATFORM[roleKey];
  if (!owner || owner === 'core') return true;
  return enabledModules.includes(owner);
}

export function sortRolesForModules<T extends { role_key: string; role_name: string }>(
  roles: T[],
  enabledModules: PlatformModule[],
): T[] {
  const hrFirst =
    enabledModules.includes('hr') && !enabledModules.includes('billing');

  const order = hrFirst
    ? [
        'primary_admin',
        'hr_admin',
        'team_lead',
        'payroll_clerk',
        'sales',
        'accountant',
        'inventory_manager',
      ]
    : [
        'primary_admin',
        'sales',
        'accountant',
        'inventory_manager',
        'hr_admin',
        'team_lead',
        'payroll_clerk',
      ];

  const rank = (key: string) => {
    const idx = order.indexOf(key);
    return idx === -1 ? 50 : idx;
  };

  return [...roles].sort((a, b) => {
    const dr = rank(a.role_key) - rank(b.role_key);
    if (dr !== 0) return dr;
    return a.role_name.localeCompare(b.role_name);
  });
}

export { BILLING_ROLE_KEYS, HR_ROLE_KEYS };
