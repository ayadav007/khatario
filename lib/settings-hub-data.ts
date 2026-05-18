/**
 * Settings hub grid — same destinations as Sidebar settings nav (keep in sync when adding routes).
 */

export interface SettingsHubLink {
  href: string;
  label: string;
  module?: string;
  featureKey?: string;
  isLocked?: boolean;
  /** Synonyms / acronyms matched by the settings hub search (e.g. pos → POS mode). */
  searchKeywords?: string[];
}

export interface SettingsHubColumn {
  id: string;
  title: string;
  /** 0–6 maps to theme accent palette in SettingsHub */
  accentIndex: number;
  links: SettingsHubLink[];
}

export interface SettingsHubSection {
  id: string;
  title: string;
  description: string;
  columns: SettingsHubColumn[];
}

export const SETTINGS_HUB_SECTIONS: SettingsHubSection[] = [
  {
    id: 'organization',
    title: 'Organization settings',
    description: 'Company profile, people, compliance, accounting, and billing',
    columns: [
      {
        id: 'org-core',
        title: 'Organization',
        accentIndex: 0,
        links: [
          {
            href: '/settings/business',
            label: 'Organization',
            module: 'settings',
            searchKeywords: ['profile', 'company', 'gstin', 'logo', 'business profile', 'details'],
          },
          { href: '/settings/suppliers-directory', label: 'Suppliers directory', module: 'settings' },
          { href: '/settings/financial-years', label: 'Financial years', module: 'settings' },
          { href: '/settings/branches', label: 'Branches', module: 'settings' },
          { href: '/settings/warehouses', label: 'Warehouses', module: 'warehouses' },
          {
            href: '/settings/business#pos-mode',
            label: 'POS mode',
            module: 'settings',
            featureKey: 'pos_mode',
            searchKeywords: ['pos', 'point of sale', 'retail', 'checkout', 'billing', 'counter'],
          },
        ],
      },
      {
        id: 'users',
        title: 'Users & access',
        accentIndex: 1,
        links: [
          { href: '/settings/user-management', label: 'User management', module: 'settings' },
          { href: '/settings/users', label: 'Manage users', module: 'settings' },
          { href: '/settings/roles', label: 'Manage roles', module: 'settings' },
          { href: '/settings/user-branches', label: 'User branches', module: 'settings' },
          { href: '/settings/user-warehouses', label: 'User warehouses', module: 'settings' },
          { href: '/settings/activity', label: 'Activity logs', module: 'settings' },
        ],
      },
      {
        id: 'tax',
        title: 'Taxes & compliance',
        accentIndex: 4,
        links: [
          { href: '/settings/tax', label: 'Tax & GST settings', module: 'settings' },
          { href: '/settings/gst-config', label: 'GST configuration', module: 'settings' },
        ],
      },
      {
        id: 'accounting',
        title: 'Accounting',
        accentIndex: 5,
        links: [
          { href: '/settings/help/how-to', label: 'How-to guides', module: 'settings', searchKeywords: ['help', 'docs', 'documentation', 'tutorial', 'learn'] },
          { href: '/settings/account-mappings', label: 'Account mappings', module: 'settings' },
          { href: '/settings/period-locks', label: 'Period locks', module: 'settings' },
        ],
      },
      {
        id: 'subscription',
        title: 'Plan & billing',
        accentIndex: 1,
        links: [{ href: '/settings/subscription', label: 'Plan & billing', module: 'settings' }],
      },
    ],
  },
  {
    id: 'module',
    title: 'Module settings',
    description: 'Templates, integrations, HR, and more',
    columns: [
      {
        id: 'general',
        title: 'General',
        accentIndex: 2,
        links: [
          { href: '/settings/features', label: 'UI features', module: 'settings' },
          { href: '/settings/backup', label: 'Backup & restore', module: 'settings' },
          { href: '/settings/automation', label: 'Workflow automation', module: 'settings' },
        ],
      },
      {
        id: 'customization',
        title: 'Customization',
        accentIndex: 3,
        links: [
          { href: '/settings/templates', label: 'Templates & printing', module: 'settings' },
          { href: '/settings/invoice', label: 'Invoice design', module: 'settings' },
          {
            href: '/settings/label-templates',
            label: 'Label templates',
            module: 'settings',
            featureKey: 'barcode_label_templates',
          },
          {
            href: '/settings/bluetooth-printer',
            label: 'Bluetooth printer',
            module: 'settings',
            featureKey: 'barcode_thermal_printer',
          },
          { href: '/settings/number-series', label: 'Transaction number series', module: 'settings' },
          { href: '/settings/signature', label: 'Digital signature', module: 'settings' },
        ],
      },
      {
        id: 'hr',
        title: 'HR & payroll',
        accentIndex: 6,
        links: [
          { href: '/settings/commission-rules', label: 'Commission rules', module: 'settings' },
          { href: '/settings/holidays', label: 'Holidays', module: 'settings' },
          { href: '/settings/leave-types', label: 'Leave types', module: 'settings' },
          { href: '/settings/shifts', label: 'Shifts', module: 'settings' },
        ],
      },
      {
        id: 'extensions',
        title: 'Integrations',
        accentIndex: 0,
        links: [
          { href: '/settings/integrations', label: 'All integrations', module: 'settings' },
          {
            href: '/settings/payments',
            label: 'Payment providers',
            module: 'settings',
            searchKeywords: ['cashfree', 'upi', 'gateway', 'psp', 'payment'],
          },
          { href: '/settings/integrations?category=whatsapp', label: 'WhatsApp', module: 'settings' },
          { href: '/settings/integrations?category=hr', label: 'HR', module: 'settings' },
          { href: '/settings/integrations?category=sms', label: 'SMS', module: 'settings' },
          { href: '/settings/integrations?category=ai', label: 'AI', module: 'settings' },
          { href: '/settings/integrations?category=crm', label: 'CRM', module: 'settings' },
        ],
      },
      {
        id: 'help',
        title: 'Help',
        accentIndex: 3,
        links: [{ href: '/settings/help', label: 'Help & support', module: 'settings' }],
      },
    ],
  },
];
