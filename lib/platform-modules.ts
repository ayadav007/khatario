/**
 * Platform modules — composable product areas on one account.
 * Signup enables an initial module; customers add Billing, HR, Connect, CRM later.
 */

import { normalizeProductLine, type ProductLine } from '@/lib/product-lines';

export const PLATFORM_MODULES = ['billing', 'hr', 'connect', 'crm'] as const;
export type PlatformModule = (typeof PLATFORM_MODULES)[number];

export const PLATFORM_MODULE_LABELS: Record<PlatformModule, string> = {
  billing: 'Billing',
  hr: 'HR',
  connect: 'Connect',
  crm: 'CRM',
};

/** Signup entry maps to the first enabled module. */
export function productLineToModule(productLine: ProductLine): PlatformModule {
  switch (productLine) {
    case 'hr':
      return 'hr';
    case 'connect':
      return 'connect';
    default:
      return 'billing';
  }
}

export function normalizePlatformModule(value: unknown): PlatformModule | null {
  if (typeof value === 'string' && PLATFORM_MODULES.includes(value as PlatformModule)) {
    return value as PlatformModule;
  }
  return null;
}

export function getDefaultHomePath(input: {
  enabledModules: PlatformModule[];
  primaryModule?: PlatformModule | null;
}): string {
  const enabled = input.enabledModules.length
    ? input.enabledModules
    : (['billing'] as PlatformModule[]);
  const primary =
    input.primaryModule && enabled.includes(input.primaryModule)
      ? input.primaryModule
      : enabled[0];

  switch (primary) {
    case 'hr':
      return '/hr/dashboard';
    case 'connect':
      return '/whatsapp/dashboard';
    case 'crm':
      return '/dashboard';
    default:
      return '/dashboard';
  }
}

/** Top-level sidebar section label → required module (null = always show). */
export const NAV_SECTION_MODULE: Record<string, PlatformModule | null> = {
  Dashboard: null,
  Sales: 'billing',
  Purchases: 'billing',
  Inventory: 'billing',
  Accounting: 'billing',
  Reports: 'billing',
  Supplier: 'billing',
  'HR & Employees': 'hr',
  Tools: null,
  More: null,
  'Settings & data': null,
  Support: null,
};

/** Settings hub column id → required module (omit = always show). */
export const SETTINGS_HUB_COLUMN_MODULE: Partial<Record<string, PlatformModule>> = {
  accounting: 'billing',
  'sales-billing': 'billing',
  'inventory-items': 'billing',
  hr: 'hr',
  connect: 'connect',
};

/** Settings hub link href → required module (omit = always show). */
export const SETTINGS_HUB_LINK_MODULE: Partial<Record<string, PlatformModule>> = {
  '/settings/suppliers-directory': 'billing',
  '/settings/financial-years': 'billing',
  '/settings/warehouses': 'billing',
  '/settings/business#pos-mode': 'billing',
  '/settings/account-mappings': 'billing',
  '/settings/period-locks': 'billing',
  '/settings/user-warehouses': 'billing',
  '/settings/payments': 'billing',
  '/settings/whatsapp': 'connect',
  '/settings/integrations?category=crm': 'crm',
  '/items/categories': 'billing',
};

export function isSettingsHubColumnVisible(
  columnId: string,
  enabledModules: PlatformModule[],
): boolean {
  const required = SETTINGS_HUB_COLUMN_MODULE[columnId];
  if (!required) return true;
  return enabledModules.includes(required);
}

export function isSettingsHubLinkVisibleForModules(
  href: string,
  enabledModules: PlatformModule[],
): boolean {
  const required = SETTINGS_HUB_LINK_MODULE[href];
  if (!required) return true;
  return enabledModules.includes(required);
}

/** Path prefixes owned by each module (for route guards). */
export const MODULE_ROUTE_PREFIXES: Record<PlatformModule, string[]> = {
  billing: [
    '/dashboard',
    '/invoices',
    '/customers',
    '/items',
    '/purchases',
    '/suppliers',
    '/reports',
    '/payments',
    '/accounts',
    '/ledger',
    '/estimates',
    '/sales-orders',
    '/credit-notes',
    '/debit-notes',
    '/delivery-challans',
    '/expenses',
    '/stock-transfers',
    '/inventory-adjustments',
    '/pricing',
  ],
  hr: ['/employees', '/hr'],
  connect: ['/whatsapp', '/connect'],
  crm: ['/crm'],
};

export function moduleForPath(pathname: string): PlatformModule | null {
  const path = pathname.split('?')[0];
  for (const mod of PLATFORM_MODULES) {
    for (const prefix of MODULE_ROUTE_PREFIXES[mod]) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        return mod;
      }
    }
  }
  return null;
}

export function isNavSectionVisible(
  sectionLabel: string,
  enabledModules: PlatformModule[],
): boolean {
  const required = NAV_SECTION_MODULE[sectionLabel];
  if (required === null || required === undefined) return true;
  return enabledModules.includes(required);
}

export function productLineForModule(moduleKey: PlatformModule): ProductLine {
  if (moduleKey === 'hr') return 'hr';
  if (moduleKey === 'connect') return 'connect';
  return 'billing';
}

export function deriveModulesFromProductLine(productLine: unknown): {
  enabled: PlatformModule[];
  primary: PlatformModule;
} {
  const line = normalizeProductLine(productLine);
  const primary = productLineToModule(line);
  return { enabled: [primary], primary };
}
