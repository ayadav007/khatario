/**
 * Module-scoped settings navigation — single source of truth for hub + sidebar.
 * Shared settings are duplicated under each enabled platform module (Billing, HR, Connect, CRM).
 */

import type { PlatformModule } from '@/lib/platform-modules';

export const SETTINGS_MODULE_ORDER: PlatformModule[] = ['billing', 'hr', 'connect', 'crm'];

export type SettingsNavLink = {
  href: string;
  label: string;
  /** PBAC permission module (defaults to settings in builders). */
  permissionModule?: string;
  featureKey?: string;
  searchKeywords?: string[];
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

const sharedPlanLinks: SettingsNavLink[] = [
  { href: '/settings/products', label: 'Your products' },
  { href: '/settings/subscription', label: 'Plan & billing' },
];

const sharedUserLinks: SettingsNavLink[] = [
  { href: '/settings/user-management', label: 'User management' },
  { href: '/settings/users', label: 'Manage users' },
  { href: '/settings/roles', label: 'Manage roles' },
  { href: '/settings/user-branches', label: 'User branches' },
  { href: '/settings/activity', label: 'Activity logs' },
];

const sharedUserLinksBilling: SettingsNavLink[] = [
  ...sharedUserLinks,
  { href: '/settings/user-warehouses', label: 'User warehouses' },
];

const sharedHelpLinks: SettingsNavLink[] = [
  { href: '/settings/help', label: 'Help & support' },
  { href: '/settings/help/how-to', label: 'How-to guides', searchKeywords: ['docs', 'tutorial'] },
];

const businessProfileLink: SettingsNavLink = {
  href: '/settings/business',
  label: 'Business profile',
  searchKeywords: ['profile', 'company', 'logo', 'organization'],
};

const branchesLink: SettingsNavLink = {
  href: '/settings/branches',
  label: 'Branches',
  searchKeywords: ['location', 'outlet'],
};

const financialYearsLink: SettingsNavLink = {
  href: '/settings/financial-years',
  label: 'Financial years',
  searchKeywords: ['fiscal', 'payroll', 'income tax', 'fy'],
};

const backupLink: SettingsNavLink = {
  href: '/settings/backup',
  label: 'Backup & restore',
  searchKeywords: ['export', 'download data'],
};

const emailLink: SettingsNavLink = {
  href: '/settings/email',
  label: 'Email (SMTP)',
  searchKeywords: ['smtp', 'gmail', 'mail'],
};

const smsLink: SettingsNavLink = {
  href: '/settings/integrations?category=sms',
  label: 'SMS',
};

export const SETTINGS_BY_PLATFORM_MODULE: Record<PlatformModule, SettingsModuleDefinition> = {
  billing: {
    title: 'Billing',
    description: 'Invoicing, inventory, accounting, and organization settings for billing',
    groups: [
      {
        id: 'organization',
        title: 'Organization',
        links: [
          businessProfileLink,
          { href: '/settings/suppliers-directory', label: 'Suppliers directory' },
          financialYearsLink,
          branchesLink,
          { href: '/settings/warehouses', label: 'Warehouses', permissionModule: 'warehouses' },
          {
            href: '/settings/business#pos-mode',
            label: 'POS mode',
            featureKey: 'pos_mode',
            searchKeywords: ['pos', 'point of sale', 'checkout'],
          },
        ],
      },
      {
        id: 'users',
        title: 'Users & access',
        links: sharedUserLinksBilling,
      },
      {
        id: 'subscription',
        title: 'Plan & billing',
        links: sharedPlanLinks,
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
          {
            href: '/connect/whatsapp',
            label: 'Send invoices on WhatsApp',
            searchKeywords: ['whatsapp', 'invoice', 'reminder'],
          },
          {
            href: '/settings/online-store',
            label: 'Online Store',
            featureKey: 'online_store',
            searchKeywords: ['store', 'storefront', 'e-commerce', 'catalog', 'subdomain'],
          },
          {
            href: '/settings/online-store/orders',
            label: 'Store Orders',
            featureKey: 'online_store',
            searchKeywords: ['orders', 'store orders', 'online orders'],
          },
        ],
      },
      {
        id: 'inventory-items',
        title: 'Inventory & items',
        links: [
          {
            href: '/settings/business#bp-features',
            label: 'Item defaults',
            searchKeywords: ['variants', 'stock', 'warehouse'],
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
        id: 'general',
        title: 'General',
        links: [
          { href: '/settings/features', label: 'UI features' },
          backupLink,
          {
            href: '/settings/offline-sync',
            label: 'Offline sync',
            searchKeywords: ['catalog', 'cache', 'airplane'],
          },
          { href: '/settings/automation', label: 'Workflow automation' },
        ],
      },
      {
        id: 'integrations',
        title: 'Integrations',
        links: [
          { href: '/settings/integrations', label: 'All integrations' },
          emailLink,
          {
            href: '/settings/payments',
            label: 'Payment providers',
            searchKeywords: ['cashfree', 'upi', 'gateway'],
          },
          smsLink,
          {
            href: '/settings/ai-config',
            label: 'AI sales agent',
            searchKeywords: ['ai', 'chatbot', 'whatsapp'],
          },
          { href: '/settings/ai-assistant', label: 'AI assistant' },
        ],
      },
      {
        id: 'help',
        title: 'Help',
        links: sharedHelpLinks,
      },
    ],
  },

  hr: {
    title: 'HR',
    description: 'Payroll, attendance, leave, and organization settings for HR',
    groups: [
      {
        id: 'organization',
        title: 'Organization',
        links: [
          businessProfileLink,
          {
            href: '/settings/departments',
            label: 'Departments & designations',
            searchKeywords: ['department', 'designation', 'org', 'job title'],
          },
          {
            href: '/settings/hr-employee',
            label: 'Employee management',
            searchKeywords: ['probation', 'employee id', 'visibility'],
          },
          {
            href: '/settings/hr-exit',
            label: 'Exit process',
            searchKeywords: ['resignation', 'notice period', 'fnf'],
          },
          branchesLink,
          financialYearsLink,
        ],
      },
      {
        id: 'users',
        title: 'Users & access',
        links: sharedUserLinks,
      },
      {
        id: 'subscription',
        title: 'Plan & billing',
        links: sharedPlanLinks,
      },
      {
        id: 'hr-time-attendance',
        title: 'Time & attendance',
        links: [
          { href: '/settings/shifts', label: 'Shifts' },
          { href: '/hr/shifts/roster', label: 'Shift roster' },
          {
            href: '/hr/shifts/bulk-assign',
            label: 'Bulk assign shifts',
            searchKeywords: ['roster', 'assign', 'shift'],
          },
          { href: '/settings/weekly-off', label: 'Weekly off' },
          { href: '/settings/holiday-lists', label: 'Holiday lists' },
          { href: '/settings/holidays', label: 'Holidays (legacy)' },
          { href: '/settings/ot-policy', label: 'Overtime policy' },
          { href: '/settings/attendance-policy', label: 'Attendance policy' },
          { href: '/settings/attendance-regularization', label: 'Regularization' },
        ],
      },
      {
        id: 'hr-leave',
        title: 'Leave',
        links: [
          { href: '/settings/leave-plan', label: 'Leave plan' },
          { href: '/settings/leave-types', label: 'Leave types' },
          { href: '/settings/holidays', label: 'Holidays' },
          { href: '/settings/hr-approval', label: 'HR approvals' },
          {
            href: '/hr/leaves/year-end',
            label: 'Leave year-end',
            searchKeywords: ['carry forward', 'lapse', 'year end'],
          },
          {
            href: '/hr/leaves/import-balances',
            label: 'Import leave balances',
            searchKeywords: ['import', 'balances', 'opening'],
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
          },
          {
            href: '/settings/salary-components',
            label: 'Salary components',
            searchKeywords: ['basic', 'hra', 'allowance', 'earning', 'deduction', 'payroll'],
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
          },
          {
            href: '/settings/onboarding-templates',
            label: 'Onboarding templates',
            searchKeywords: ['recruitment', 'portal'],
          },
          {
            href: '/settings/offer-letter',
            label: 'Offer letter template',
            searchKeywords: ['offer', 'pdf'],
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
          },
        ],
      },
      {
        id: 'general',
        title: 'General',
        links: [backupLink],
      },
      {
        id: 'integrations',
        title: 'Integrations',
        links: [emailLink, smsLink],
      },
      {
        id: 'help',
        title: 'Help',
        links: sharedHelpLinks,
      },
    ],
  },

  connect: {
    title: 'Connect',
    description: 'WhatsApp inbox, bot, campaigns, and messaging integrations',
    groups: [
      {
        id: 'organization',
        title: 'Organization',
        links: [businessProfileLink, branchesLink],
      },
      {
        id: 'users',
        title: 'Users & access',
        links: sharedUserLinks,
      },
      {
        id: 'subscription',
        title: 'Plan & billing',
        links: sharedPlanLinks,
      },
      {
        id: 'connect',
        title: 'Connect',
        links: [
          {
            href: '/connect/whatsapp',
            label: 'WhatsApp number',
            searchKeywords: ['meta', 'cloud api', 'qr'],
          },
          {
            href: '/settings/whatsapp',
            label: 'Bot & messaging',
            searchKeywords: ['inbox', 'campaigns', 'bot'],
          },
        ],
      },
      {
        id: 'general',
        title: 'General',
        links: [backupLink],
      },
      {
        id: 'integrations',
        title: 'Integrations',
        links: [
          emailLink,
          smsLink,
          { href: '/settings/ai-config', label: 'AI sales agent' },
          { href: '/settings/ai-assistant', label: 'AI assistant' },
        ],
      },
      {
        id: 'help',
        title: 'Help',
        links: sharedHelpLinks,
      },
    ],
  },

  crm: {
    title: 'CRM',
    description: 'Customer relationships and CRM integrations',
    groups: [
      {
        id: 'organization',
        title: 'Organization',
        links: [businessProfileLink, branchesLink],
      },
      {
        id: 'users',
        title: 'Users & access',
        links: sharedUserLinks,
      },
      {
        id: 'subscription',
        title: 'Plan & billing',
        links: sharedPlanLinks,
      },
      {
        id: 'integrations',
        title: 'Integrations',
        links: [
          { href: '/settings/integrations', label: 'All integrations' },
          { href: '/settings/integrations?category=crm', label: 'CRM integrations' },
        ],
      },
      {
        id: 'general',
        title: 'General',
        links: [backupLink],
      },
      {
        id: 'help',
        title: 'Help',
        links: sharedHelpLinks,
      },
    ],
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
  organization: 0,
  users: 1,
  subscription: 1,
  accounting: 5,
  'sales-billing': 3,
  'inventory-items': 2,
  general: 2,
  'hr-time-attendance': 6,
  'hr-leave': 6,
  'hr-payroll': 6,
  'hr-hiring': 6,
  'hr-employee-portal': 6,
  connect: 5,
  integrations: 0,
  help: 3,
};

export type SettingsNavFilterOptions = {
  hasFeature?: (featureKey: string) => boolean;
};

function filterLinks(
  links: SettingsNavLink[],
  opts: SettingsNavFilterOptions,
): SettingsNavLink[] {
  return links.filter((link) => {
    if (link.featureKey && opts.hasFeature && !opts.hasFeature(link.featureKey)) {
      return false;
    }
    return true;
  });
}

export function getEnabledSettingsModuleDefinitions(
  enabledModules: PlatformModule[],
  opts: SettingsNavFilterOptions = {},
): Array<{ platformModule: PlatformModule } & SettingsModuleDefinition> {
  const modules =
    enabledModules.length > 0 ? enabledModules : (['billing'] as PlatformModule[]);

  return SETTINGS_MODULE_ORDER.filter((m) => modules.includes(m)).map((platformModule) => {
    const def = SETTINGS_BY_PLATFORM_MODULE[platformModule];
    const groups = def.groups
      .map((group) => ({
        ...group,
        links: filterLinks(group.links, opts),
      }))
      .filter((group) => group.links.length > 0);

    return { platformModule, ...def, groups };
  });
}

export function buildSettingsHubSections(
  enabledModules: PlatformModule[],
  opts: SettingsNavFilterOptions = {},
): SettingsHubSection[] {
  return getEnabledSettingsModuleDefinitions(enabledModules, opts).map(
    ({ platformModule, title, description, groups }) => ({
      id: platformModule,
      title,
      description,
      columns: groups.map((group) => ({
        id: `${platformModule}-${group.id}`,
        title: group.title,
        accentIndex: GROUP_ACCENT[group.id] ?? 2,
        links: group.links.map((link) => ({
          ...link,
          module: link.permissionModule ?? 'settings',
        })),
      })),
    }),
  );
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

export function buildSettingsSidebarBlocks(
  enabledModules: PlatformModule[],
  opts: SettingsNavFilterOptions = {},
): SettingsSidebarModuleBlock[] {
  return getEnabledSettingsModuleDefinitions(enabledModules, opts).map(
    ({ platformModule, title, groups }) => ({
      platformModule,
      label: title.toUpperCase(),
      groups: groups.map((group) => ({
        title: group.title,
        groupId: group.id,
        links: group.links.map((link) => ({
          ...link,
          module: link.permissionModule ?? 'settings',
        })),
      })),
    }),
  );
}
