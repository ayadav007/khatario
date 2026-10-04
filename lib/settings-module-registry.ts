/**
 * Settings navigation — one list for the hub and the sidebar.
 * Shared settings (account, team, plan, integrations, system, help) appear once.
 * Product-specific groups are added only for enabled modules.
 */

import type { PlatformModule } from '@/lib/platform-modules';
import { hasFullHrFeatures } from '@/lib/subscription/hr-lite';

export const SETTINGS_MODULE_ORDER: PlatformModule[] = ['billing', 'hr', 'connect', 'crm'];

const ALL_MODULES: PlatformModule[] = [...SETTINGS_MODULE_ORDER];

export type SettingsNavLink = {
  href: string;
  label: string;
  /** PBAC permission module (defaults to settings in builders). */
  permissionModule?: string;
  featureKey?: string;
  /** Hide on Billing-bundled HR Lite (needs leave/portal / paid HR). */
  requiresFullHr?: boolean;
  searchKeywords?: string[];
  /** Modules that may open this URL. Omit on a module group to use that module. */
  accessModules?: PlatformModule[];
  /** Modules that show this link. Defaults to accessModules. */
  showForModules?: PlatformModule[];
};

export type SettingsNavGroup = {
  id: string;
  title: string;
  links: SettingsNavLink[];
};

export type SettingsModuleDefinition = {
  title: string;
  description: string;
  groups: SettingsNavGroup[];
};

const businessProfileLink: SettingsNavLink = {
  href: '/settings/business',
  label: 'Business profile',
  searchKeywords: ['profile', 'company', 'logo', 'organization'],
  accessModules: ALL_MODULES,
};

const branchesLink: SettingsNavLink = {
  href: '/settings/branches',
  label: 'Branches',
  searchKeywords: ['location', 'outlet'],
  accessModules: ALL_MODULES,
};

const financialYearsLink: SettingsNavLink = {
  href: '/settings/financial-years',
  label: 'Financial years',
  searchKeywords: ['fiscal', 'payroll', 'income tax', 'fy'],
  accessModules: ['billing', 'hr'],
};

const backupLink: SettingsNavLink = {
  href: '/settings/backup',
  label: 'Backup & restore',
  searchKeywords: ['export', 'download data'],
  accessModules: ALL_MODULES,
};

const emailLink: SettingsNavLink = {
  href: '/settings/email',
  label: 'Email (SMTP)',
  searchKeywords: ['smtp', 'gmail', 'mail'],
  accessModules: ['billing', 'hr', 'connect'],
};

const smsLink: SettingsNavLink = {
  href: '/settings/integrations?category=sms',
  label: 'SMS',
  accessModules: ['billing', 'hr', 'connect'],
};

/** Shown once, above product-specific groups. */
export const SETTINGS_SHARED_GROUPS: SettingsNavGroup[] = [
  {
    id: 'account',
    title: 'Account',
    links: [
      businessProfileLink,
      branchesLink,
      financialYearsLink,
      {
        href: '/settings/warehouses',
        label: 'Warehouses',
        permissionModule: 'warehouses',
        accessModules: ['billing'],
      },
    ],
  },
  {
    id: 'team',
    title: 'Team & permissions',
    links: [
      {
        href: '/settings/user-management',
        label: 'User management',
        accessModules: ALL_MODULES,
      },
      { href: '/settings/users', label: 'Manage users', accessModules: ALL_MODULES },
      { href: '/settings/roles', label: 'Manage roles', accessModules: ALL_MODULES },
      { href: '/settings/user-branches', label: 'User branches', accessModules: ALL_MODULES },
      {
        href: '/settings/user-warehouses',
        label: 'User warehouses',
        permissionModule: 'warehouses',
        accessModules: ['billing'],
      },
      { href: '/settings/activity', label: 'Activity logs', accessModules: ALL_MODULES },
    ],
  },
  {
    id: 'plan',
    title: 'Plan',
    links: [
      { href: '/settings/products', label: 'Your products', accessModules: ALL_MODULES },
      { href: '/settings/subscription', label: 'Plan & billing', accessModules: ALL_MODULES },
    ],
  },
];

const SETTINGS_TAIL_GROUPS: SettingsNavGroup[] = [
  {
    id: 'integrations',
    title: 'Integrations',
    links: [
      {
        href: '/settings/integrations',
        label: 'All integrations',
        accessModules: ['billing', 'crm'],
      },
      emailLink,
      {
        href: '/settings/payments',
        label: 'Payment providers',
        searchKeywords: ['cashfree', 'upi', 'gateway'],
        accessModules: ['billing'],
      },
      smsLink,
      {
        href: '/settings/integrations?category=crm',
        label: 'CRM integrations',
        accessModules: ['crm'],
      },
    ],
  },
  {
    id: 'system',
    title: 'System',
    links: [
      {
        href: '/settings/features',
        label: 'Appearance',
        searchKeywords: ['ui features', 'theme', 'dark mode', 'branding', 'portal'],
        accessModules: ALL_MODULES,
      },
      backupLink,
    ],
  },
  {
    id: 'help',
    title: 'Help',
    links: [
      { href: '/settings/help', label: 'Help & support', accessModules: ALL_MODULES },
      {
        href: '/settings/help/how-to',
        label: 'How-to guides',
        searchKeywords: ['docs', 'tutorial'],
        accessModules: ALL_MODULES,
      },
    ],
  },
];

/** WhatsApp pages, matching the in-page tabs. Inbox and agents are Connect-only in the menu. */
export const WHATSAPP_SETTINGS_GROUP: SettingsNavGroup = {
  id: 'whatsapp',
  title: 'WhatsApp',
  links: [
    {
      href: '/settings/whatsapp',
      label: 'Connection',
      searchKeywords: ['whatsapp', 'qr', 'meta', 'cloud api'],
      accessModules: ['billing', 'connect'],
    },
    {
      href: '/settings/whatsapp/templates',
      label: 'Templates',
      searchKeywords: ['whatsapp', 'template', 'reminder', 'invoice'],
      accessModules: ['billing', 'connect'],
    },
    {
      href: '/settings/whatsapp/notifications',
      label: 'Notifications',
      searchKeywords: ['whatsapp', 'reminder', 'notification'],
      accessModules: ['billing', 'connect'],
    },
    {
      href: '/settings/whatsapp/inbox',
      label: 'Inbox & team',
      searchKeywords: ['whatsapp', 'inbox', 'auto assign'],
      accessModules: ['billing', 'connect'],
      showForModules: ['connect'],
    },
    {
      href: '/settings/whatsapp/team',
      label: 'Agents',
      searchKeywords: ['whatsapp', 'agents', 'team'],
      accessModules: ['billing', 'connect'],
      showForModules: ['connect'],
    },
    {
      href: '/settings/whatsapp/ai-agent',
      label: 'AI agent',
      searchKeywords: ['ai', 'ai agent', 'chatbot', 'bot', 'assistant', 'knowledge'],
      accessModules: ['billing', 'connect'],
    },
    {
      href: '/settings/whatsapp/shop',
      label: 'Shop',
      searchKeywords: ['shop', 'catalog', 'whatsapp'],
      accessModules: ['billing', 'connect'],
    },
  ],
};

/**
 * Paths kept for bookmarks and route guards, not shown in the menu.
 * Holiday calendar remains reachable; Holiday lists is the menu entry.
 */
export const SETTINGS_ACCESS_ONLY: { href: string; modules: PlatformModule[] }[] = [
  { href: '/settings/holidays', modules: ['hr'] },
];

export const SETTINGS_BY_PLATFORM_MODULE: Record<PlatformModule, SettingsModuleDefinition> = {
  billing: {
    title: 'Billing',
    description: 'Invoicing, inventory, and accounting settings',
    groups: [
      {
        id: 'billing-setup',
        title: 'Billing setup',
        links: [
          { href: '/settings/suppliers-directory', label: 'Suppliers directory' },
          {
            href: '/settings/business#pos-mode',
            label: 'POS mode',
            featureKey: 'pos_mode',
            searchKeywords: ['pos', 'point of sale', 'checkout'],
          },
        ],
      },
      {
        id: 'accounting',
        title: 'Accounting',
        links: [
          { href: '/settings/account-mappings', label: 'Account mappings' },
          { href: '/settings/period-locks', label: 'Period locks' },
        ],
      },
      {
        id: 'sales-billing',
        title: 'Sales & billing',
        links: [
          {
            href: '/settings/templates',
            label: 'Templates & printing',
            searchKeywords: ['invoice', 'thermal', 'print'],
          },
          {
            href: '/settings/bluetooth-printer',
            label: 'Print & devices',
            featureKey: 'barcode_thermal_printer',
          },
          {
            href: '/settings/custom-fields',
            label: 'Custom fields',
            searchKeywords: ['invoice fields', 'item fields'],
          },
          { href: '/settings/number-series', label: 'Transaction number series' },
        ],
      },
      {
        id: 'online-store',
        title: 'Online store',
        links: [
          {
            href: '/settings/online-store',
            label: 'Storefront',
            featureKey: 'online_store',
            searchKeywords: ['store', 'storefront', 'e-commerce', 'catalog', 'subdomain', 'theme', 'editor'],
          },
          {
            href: '/settings/online-store/orders',
            label: 'Store orders',
            featureKey: 'online_store',
            searchKeywords: ['orders', 'store orders', 'online orders'],
          },
          {
            href: '/settings/online-store/enquiries',
            label: 'Store enquiries',
            featureKey: 'online_store',
            searchKeywords: ['enquiries', 'contact form', 'messages', 'inbox', 'leads'],
          },
        ],
      },
      {
        id: 'inventory-items',
        title: 'Inventory',
        links: [
          {
            href: '/settings/business#bp-features',
            label: 'Item defaults',
            searchKeywords: ['variants', 'stock', 'warehouse', 'billing preferences'],
          },
          {
            href: '/settings/label-templates',
            label: 'Label templates',
            featureKey: 'barcode_label_templates',
          },
          {
            href: '/items/categories',
            label: 'Item categories',
            permissionModule: 'items',
            searchKeywords: ['categories'],
          },
        ],
      },
      {
        id: 'billing-general',
        title: 'Billing tools',
        links: [
          {
            href: '/settings/offline-sync',
            label: 'Offline sync',
            searchKeywords: ['catalog', 'cache', 'airplane'],
          },
          { href: '/settings/automation', label: 'Workflow automation' },
        ],
      },
    ],
  },

  hr: {
    title: 'People',
    description: 'Attendance, leave, payroll, and hiring settings',
    groups: [
      {
        id: 'hr-organization',
        title: 'HR setup',
        links: [
          {
            href: '/settings/departments',
            label: 'Departments & designations',
            searchKeywords: ['department', 'designation', 'org', 'job title'],
          },
          {
            href: '/settings/hr-employee',
            label: 'Employee management',
            searchKeywords: ['probation', 'employee id', 'visibility'],
            requiresFullHr: true,
          },
          {
            href: '/settings/hr-exit',
            label: 'Exit process',
            searchKeywords: ['resignation', 'notice period', 'fnf'],
            requiresFullHr: true,
          },
        ],
      },
      {
        id: 'hr-time-attendance',
        title: 'Time & attendance',
        links: [
          { href: '/settings/shifts', label: 'Shifts', requiresFullHr: true },
          { href: '/hr/shifts/roster', label: 'Shift roster', requiresFullHr: true },
          {
            href: '/hr/shifts/bulk-assign',
            label: 'Bulk assign shifts',
            searchKeywords: ['roster', 'assign', 'shift'],
            requiresFullHr: true,
          },
          { href: '/settings/weekly-off', label: 'Weekly off' },
          { href: '/settings/holiday-lists', label: 'Holiday lists', requiresFullHr: true },
          { href: '/settings/ot-policy', label: 'Overtime policy', requiresFullHr: true },
          {
            href: '/settings/attendance-policy',
            label: 'Attendance policy',
            requiresFullHr: true,
          },
          {
            href: '/settings/attendance-regularization',
            label: 'Regularization',
            requiresFullHr: true,
          },
        ],
      },
      {
        id: 'hr-leave',
        title: 'Leave',
        links: [
          { href: '/settings/leave-plan', label: 'Leave plan', requiresFullHr: true },
          { href: '/settings/leave-types', label: 'Leave types', requiresFullHr: true },
          { href: '/settings/hr-approval', label: 'HR approvals', requiresFullHr: true },
          {
            href: '/hr/leaves/year-end',
            label: 'Leave year-end',
            searchKeywords: ['carry forward', 'lapse', 'year end'],
            requiresFullHr: true,
          },
          {
            href: '/hr/leaves/import-balances',
            label: 'Import leave balances',
            searchKeywords: ['import', 'balances', 'opening'],
            requiresFullHr: true,
          },
        ],
      },
      {
        id: 'hr-payroll',
        title: 'Payroll',
        links: [
          {
            href: '/settings/payroll',
            label: 'Payroll settings',
            searchKeywords: ['pay day', 'salary', 'statutory'],
            requiresFullHr: true,
          },
          {
            href: '/settings/salary-components',
            label: 'Salary components',
            searchKeywords: ['basic', 'hra', 'allowance', 'earning', 'deduction', 'payroll'],
            requiresFullHr: true,
          },
          { href: '/settings/commission-rules', label: 'Commission rules' },
        ],
      },
      {
        id: 'hr-hiring',
        title: 'Hiring',
        links: [
          {
            href: '/settings/hiring',
            label: 'Hiring defaults',
            searchKeywords: ['recruitment', 'onboarding invite'],
            requiresFullHr: true,
          },
          {
            href: '/settings/onboarding-templates',
            label: 'Onboarding templates',
            searchKeywords: ['recruitment', 'portal'],
            requiresFullHr: true,
          },
          {
            href: '/settings/offer-letter',
            label: 'Offer letter template',
            searchKeywords: ['offer', 'pdf'],
            requiresFullHr: true,
          },
        ],
      },
      {
        id: 'hr-employee-portal',
        title: 'Employee portal',
        links: [
          {
            href: '/settings/employee-portal',
            label: 'Portal & kiosk',
            searchKeywords: ['ess', 'self service', 'kiosk'],
            requiresFullHr: true,
          },
        ],
      },
    ],
  },

  connect: {
    title: 'Connect',
    description: 'WhatsApp inbox, bot, and messaging',
    groups: [],
  },

  crm: {
    title: 'CRM',
    description: 'Customer relationships and CRM integrations',
    groups: [],
  },
};

export type SettingsHubLink = SettingsNavLink & { module?: string; isLocked?: boolean };
export type SettingsHubColumn = {
  id: string;
  title: string;
  accentIndex: number;
  links: SettingsHubLink[];
};
export type SettingsHubSection = {
  id: string;
  title: string;
  description: string;
  columns: SettingsHubColumn[];
};

const GROUP_ACCENT: Record<string, number> = {
  account: 0,
  team: 1,
  plan: 1,
  'billing-setup': 0,
  accounting: 5,
  'sales-billing': 3,
  'online-store': 3,
  'inventory-items': 2,
  'billing-general': 2,
  'hr-organization': 6,
  'hr-time-attendance': 6,
  'hr-leave': 6,
  'hr-payroll': 6,
  'hr-hiring': 6,
  'hr-employee-portal': 6,
  whatsapp: 5,
  integrations: 0,
  system: 2,
  help: 3,
};

export type SettingsNavFilterOptions = {
  hasFeature?: (featureKey: string) => boolean;
};

function filterByPlan(links: SettingsNavLink[], opts: SettingsNavFilterOptions): SettingsNavLink[] {
  const fullHr = opts.hasFeature ? hasFullHrFeatures(opts.hasFeature) : true;
  return links.filter((link) => {
    if (link.requiresFullHr && !fullHr) return false;
    if (link.featureKey && opts.hasFeature && !opts.hasFeature(link.featureKey)) return false;
    return true;
  });
}

function linkShownForModules(
  link: SettingsNavLink,
  enabled: PlatformModule[],
  owner: PlatformModule | null,
): boolean {
  const mods = link.showForModules ?? link.accessModules ?? (owner ? [owner] : null);
  if (!mods || mods.length === 0) return true;
  return mods.some((mod) => enabled.includes(mod));
}

function prepareGroup(
  group: SettingsNavGroup,
  enabled: PlatformModule[],
  opts: SettingsNavFilterOptions,
  owner: PlatformModule | null,
): SettingsSidebarGroup | null {
  const links = filterByPlan(group.links, opts)
    .filter((link) => linkShownForModules(link, enabled, owner))
    .map((link) => ({
      ...link,
      module: link.permissionModule ?? 'settings',
    }));
  if (links.length === 0) return null;
  return { title: group.title, groupId: group.id, links };
}

export type SettingsSidebarGroup = {
  title: string;
  groupId: string;
  links: Array<SettingsNavLink & { module: string }>;
};

export type SettingsSidebarModuleBlock = {
  platformModule: PlatformModule;
  label: string;
  groups: SettingsSidebarGroup[];
};

const HUB_BANDS: { id: string; title: string; description: string; groupIds: string[] }[] = [
  {
    id: 'account',
    title: 'Account',
    description: 'Profile, team, and plan for this business',
    groupIds: ['account', 'team', 'plan'],
  },
  {
    id: 'billing',
    title: 'Billing',
    description: 'Invoicing, inventory, store, and accounting',
    groupIds: [
      'billing-setup',
      'accounting',
      'sales-billing',
      'online-store',
      'inventory-items',
      'billing-general',
    ],
  },
  {
    id: 'people',
    title: 'People',
    description: 'Attendance, leave, payroll, and hiring',
    groupIds: [
      'hr-organization',
      'hr-time-attendance',
      'hr-leave',
      'hr-payroll',
      'hr-hiring',
      'hr-employee-portal',
    ],
  },
  {
    id: 'whatsapp',
    title: 'WhatsApp',
    description: 'Connection, templates, inbox, and shop',
    groupIds: ['whatsapp'],
  },
  {
    id: 'system',
    title: 'Integrations & system',
    description: 'Apps, appearance, backup, and help',
    groupIds: ['integrations', 'system', 'help'],
  },
];

export function getEnabledSettingsModuleDefinitions(
  enabledModules: PlatformModule[],
  opts: SettingsNavFilterOptions = {},
): Array<{ platformModule: PlatformModule } & SettingsModuleDefinition> {
  const modules = enabledModules.length > 0 ? enabledModules : (['billing'] as PlatformModule[]);

  return SETTINGS_MODULE_ORDER.filter((m) => modules.includes(m)).map((platformModule) => {
    const def = SETTINGS_BY_PLATFORM_MODULE[platformModule];
    const groups: SettingsNavGroup[] = [];
    for (const group of def.groups) {
      const prepared = prepareGroup(group, modules, opts, platformModule);
      if (!prepared) continue;
      groups.push({
        id: prepared.groupId,
        title: prepared.title,
        links: prepared.links.map(({ module: _module, ...link }) => link),
      });
    }

    return {
      platformModule,
      title: def.title,
      description: def.description,
      groups,
    };
  });
}

/** One level of groups for the sidebar and hub. Shared groups are not repeated. */
export function buildFlatSettingsGroups(
  enabledModules: PlatformModule[],
  opts: SettingsNavFilterOptions = {},
): SettingsSidebarGroup[] {
  const modules = enabledModules.length > 0 ? enabledModules : (['billing'] as PlatformModule[]);
  const groups: SettingsSidebarGroup[] = [];

  const push = (group: SettingsNavGroup, owner: PlatformModule | null) => {
    const prepared = prepareGroup(group, modules, opts, owner);
    if (prepared) groups.push(prepared);
  };

  for (const group of SETTINGS_SHARED_GROUPS) push(group, null);
  for (const mod of SETTINGS_MODULE_ORDER) {
    if (!modules.includes(mod)) continue;
    for (const group of SETTINGS_BY_PLATFORM_MODULE[mod].groups) push(group, mod);
  }
  if (modules.includes('billing') || modules.includes('connect')) {
    push(WHATSAPP_SETTINGS_GROUP, null);
  }
  for (const group of SETTINGS_TAIL_GROUPS) push(group, null);

  return groups;
}

export function buildSettingsHubSections(
  enabledModules: PlatformModule[],
  opts: SettingsNavFilterOptions = {},
): SettingsHubSection[] {
  const byId = new Map(buildFlatSettingsGroups(enabledModules, opts).map((group) => [group.groupId, group]));

  return HUB_BANDS.map((band) => ({
    id: band.id,
    title: band.title,
    description: band.description,
    columns: band.groupIds.flatMap((id) => {
      const group = byId.get(id);
      if (!group) return [];
      return [
        {
          id: group.groupId,
          title: group.title,
          accentIndex: GROUP_ACCENT[group.groupId] ?? 2,
          links: group.links,
        },
      ];
    }),
  })).filter((section) => section.columns.length > 0);
}

export function buildSettingsSidebarBlocks(
  enabledModules: PlatformModule[],
  opts: SettingsNavFilterOptions = {},
): SettingsSidebarModuleBlock[] {
  return [
    {
      platformModule: 'billing',
      label: 'SETTINGS',
      groups: buildFlatSettingsGroups(enabledModules, opts),
    },
  ];
}

/** Path → modules allowed to open it. Used by the settings route guard. */
export function collectSettingsPathModules(): Map<string, PlatformModule[]> {
  const counts = new Map<string, Set<PlatformModule>>();

  const add = (href: string, mods: PlatformModule[]) => {
    const path = href.split('?')[0].split('#')[0];
    if (!counts.has(path)) counts.set(path, new Set());
    for (const mod of mods) counts.get(path)!.add(mod);
  };

  for (const group of [...SETTINGS_SHARED_GROUPS, ...SETTINGS_TAIL_GROUPS]) {
    for (const link of group.links) {
      add(link.href, link.accessModules ?? ALL_MODULES);
    }
  }

  for (const mod of SETTINGS_MODULE_ORDER) {
    for (const group of SETTINGS_BY_PLATFORM_MODULE[mod].groups) {
      for (const link of group.links) {
        add(link.href, link.accessModules ?? [mod]);
      }
    }
  }

  for (const link of WHATSAPP_SETTINGS_GROUP.links) {
    add(link.href, link.accessModules ?? ['billing', 'connect']);
  }

  for (const item of SETTINGS_ACCESS_ONLY) {
    add(item.href, item.modules);
  }

  const map = new Map<string, PlatformModule[]>();
  for (const [path, mods] of counts) {
    map.set(path, SETTINGS_MODULE_ORDER.filter((mod) => mods.has(mod)));
  }
  return map;
}
