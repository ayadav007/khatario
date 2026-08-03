import {
  getCategoryLabel,
  normalizeCategoryParam,
} from '@/lib/integrations/catalog';

function getQueryParam(
  search: string | URLSearchParams | null | undefined,
  key: string
): string | null {
  if (!search) return null;
  if (search instanceof URLSearchParams) return search.get(key);
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) return null;
  return new URLSearchParams(raw).get(key);
}

/** Exact path → mobile top bar title (matches SettingsPageShell titles where applicable). */
const SETTINGS_PATH_TITLES: Record<string, string> = {
  '/settings/business': 'Business Profile',
  '/settings/suppliers-directory': 'Suppliers directory',
  '/settings/financial-years': 'Financial years',
  '/settings/branches': 'Branches',
  '/settings/branches/new': 'Create branch',
  '/settings/warehouses': 'Warehouses',
  '/settings/warehouses/new': 'Add New Warehouse',
  '/settings/user-management': 'User Management',
  '/settings/users': 'Manage Users',
  '/settings/roles': 'Roles & Permissions',
  '/settings/user-branches': 'User-Branch Assignments',
  '/settings/user-warehouses': 'User-Warehouse Assignments',
  '/settings/activity': 'Activity Log',
  '/settings/help/how-to': 'How-to guides',
  '/settings/account-mappings': 'Account Mappings',
  '/settings/period-locks': 'Period Locks',
  '/settings/subscription': 'Subscription & Billing',
  '/settings/products': 'Your products',
  '/settings/products': 'Your products',
  '/settings/templates': 'Templates & Printing',
  '/settings/templates/customize': 'Customize Template',
  '/settings/bluetooth-printer': 'Print & devices',
  '/settings/bluetooth-printer/diagnostics': 'Printer diagnostics',
  '/settings/custom-fields': 'Custom fields',
  '/settings/number-series': 'Transaction Number Series',
  '/settings/label-templates': 'Label Templates',
  '/settings/label-templates/new': 'New label template',
  '/settings/features': 'UI features',
  '/settings/backup': 'Backup & restore',
  '/settings/offline-sync': 'Offline sync',
  '/settings/automation': 'Workflow Automation',
  '/settings/commission-rules': 'Commission Rules',
  '/settings/holidays': 'Holiday Calendar',
  '/settings/leave-types': 'Leave Types',
  '/settings/shifts': 'Shifts',
  '/settings/attendance-policy': 'Attendance policy',
  '/settings/attendance-regularization': 'Regularization',
  '/settings/payments': 'Payments',
  '/connect/whatsapp': 'Send invoices on WhatsApp',
  '/settings/whatsapp': 'WhatsApp settings',
  '/settings/help': 'Help & Support',
  '/settings/ai-config': 'AI Sales Agent',
  '/settings/ai-assistant': 'AI Assistant Settings',
  '/settings/email': 'Email settings',
};

/**
 * Mobile top bar title for /settings routes. Returns null if not a settings path.
 */
export function getSettingsMobileTitle(
  pathname: string | null,
  search?: string | URLSearchParams | null
): string | null {
  if (!pathname) return null;
  const p = pathname.replace(/\/$/, '') || '/';

  if (p === '/settings') return 'All settings';
  if (!p.startsWith('/settings')) return null;

  if (p === '/settings/integrations') {
    const category = normalizeCategoryParam(getQueryParam(search, 'category'));
    return getCategoryLabel(category === 'crm' ? 'crm' : category);
  }

  if (/^\/settings\/branches\/[^/]+\/edit$/.test(p)) return 'Edit branch';
  if (/^\/settings\/warehouses\/[^/]+\/edit$/.test(p)) return 'Edit Warehouse';
  if (/^\/settings\/label-templates\/[^/]+$/.test(p) && p !== '/settings/label-templates/new') {
    return 'Edit label template';
  }

  const exact = SETTINGS_PATH_TITLES[p];
  if (exact) return exact;

  const last = p.split('/').pop() ?? 'Settings';
  return last
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
