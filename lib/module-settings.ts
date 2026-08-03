/**
 * Contextual settings menus — shown from the mobile top bar (and reusable on desktop).
 * Keeps module-related settings in one place instead of a single deep link.
 */

export type ModuleSettingsSheetId =
  | 'items'
  | 'invoicing'
  | 'parties'
  | 'inventory'
  | 'hr'
  | 'whatsapp'
  | 'app';

export type ModuleSettingsIconKind =
  | 'app'
  | 'invoice_print'
  | 'items_labels'
  | 'organization'
  | 'warehouses'
  | 'whatsapp';

export interface ModuleSettingsEntry {
  href: string;
  label: string;
  description?: string;
  /** When set, entry is hidden unless the business has this feature. */
  featureKey?: string;
}

export interface ModuleSettingsMenu {
  sheetId: ModuleSettingsSheetId;
  title: string;
  ariaLabel: string;
  iconKind: ModuleSettingsIconKind;
  entries: ModuleSettingsEntry[];
}

function normalizePath(pathname: string | null): string {
  if (!pathname) return '/';
  const p = pathname.replace(/\/$/, '') || '/';
  return p;
}

/** @returns null → fall back to generic Settings hub link */
export function getModuleSettingsMenu(pathname: string | null): ModuleSettingsMenu | null {
  const p = normalizePath(pathname);

  if (p.startsWith('/settings')) {
    return null;
  }

  if (p.startsWith('/whatsapp')) {
    return {
      sheetId: 'whatsapp',
      title: 'WhatsApp settings',
      ariaLabel: 'WhatsApp settings',
      iconKind: 'whatsapp',
      entries: [
        { href: '/connect/whatsapp', label: 'WhatsApp number', description: 'Link your business number' },
        { href: '/settings/whatsapp', label: 'Bot & messaging', description: 'Inbox, bot rules, and reminders' },
        { href: '/settings/products', label: 'Your products', description: 'Enable or manage Connect' },
      ],
    };
  }

  if (
    p.startsWith('/invoices') ||
    p.startsWith('/sales-orders') ||
    p.startsWith('/credit-notes') ||
    p.startsWith('/debit-notes') ||
    p.startsWith('/estimates') ||
    p.startsWith('/delivery-challans')
  ) {
    return {
      sheetId: 'invoicing',
      title: 'Invoice & print settings',
      ariaLabel: 'Invoice and print settings',
      iconKind: 'invoice_print',
      entries: [
        {
          href: '/settings/templates',
          label: 'Templates & printing',
          description: 'Layout, 58mm / 80mm / A4, active template',
        },
        {
          href: '/settings/bluetooth-printer',
          label: 'Print & devices',
          description: 'PDF vs Bluetooth, pair thermal printer',
        },
        {
          href: '/settings/custom-fields?entity=invoice',
          label: 'Custom fields',
          description: 'Extra fields on invoices',
        },
        {
          href: '/settings/number-series',
          label: 'Number series',
          description: 'Invoice and document numbering',
        },
        {
          href: '/settings/business#bp-signature',
          label: 'Logo & signature',
          description: 'Upload once in business profile',
        },
      ],
    };
  }

  if (p.startsWith('/items')) {
    return {
      sheetId: 'items',
      title: 'Item settings',
      ariaLabel: 'Item settings',
      iconKind: 'items_labels',
      entries: [
        {
          href: '/settings/business#bp-features',
          label: 'Item defaults',
          description: 'Variants, stock rules, warehouses',
        },
        {
          href: '/settings/custom-fields?entity=item',
          label: 'Custom fields',
          description: 'Extra fields on items',
        },
        { href: '/items/categories', label: 'Categories', description: 'Organize your catalog' },
        {
          href: '/settings/label-templates',
          label: 'Label templates',
          description: 'Barcode label layouts',
          featureKey: 'barcode_label_templates',
        },
        { href: '/items/barcodes', label: 'Print barcodes', description: 'Bulk barcode printing' },
        {
          href: '/settings/bluetooth-printer',
          label: 'Print & devices',
          description: 'Pair label or receipt printer',
          featureKey: 'barcode_thermal_printer',
        },
      ],
    };
  }

  if (p.startsWith('/customers') || p.startsWith('/suppliers')) {
    return {
      sheetId: 'parties',
      title: 'Party settings',
      ariaLabel: 'Customer and supplier settings',
      iconKind: 'organization',
      entries: [
        {
          href: '/settings/business',
          label: 'Business profile',
          description: 'Company details, GSTIN, and branding',
        },
        {
          href: '/settings/custom-fields?entity=invoice',
          label: 'Custom fields',
          description: 'Fields on invoices (party-related)',
        },
        { href: '/settings/suppliers-directory', label: 'Suppliers directory', description: 'Shared supplier list' },
      ],
    };
  }

  if (
    p.startsWith('/purchases') ||
    p.startsWith('/stock-transfers') ||
    p.startsWith('/inventory-adjustments')
  ) {
    return {
      sheetId: 'inventory',
      title: 'Inventory settings',
      ariaLabel: 'Inventory and warehouse settings',
      iconKind: 'warehouses',
      entries: [
        { href: '/settings/warehouses', label: 'Warehouses', description: 'Locations and stock' },
        {
          href: '/settings/business#bp-features',
          label: 'Item & stock defaults',
          description: 'Variants, out-of-stock sales',
        },
        { href: '/settings/branches', label: 'Branches', description: 'Multi-branch setup' },
      ],
    };
  }

  if (p.startsWith('/employees')) {
    return {
      sheetId: 'hr',
      title: 'HR settings',
      ariaLabel: 'HR and payroll settings',
      iconKind: 'organization',
      entries: [
        { href: '/settings/users', label: 'Users', description: 'Team accounts' },
        { href: '/settings/roles', label: 'Roles', description: 'Permissions' },
        { href: '/settings/shifts', label: 'Shifts', description: 'Work schedules' },
        { href: '/settings/attendance-policy', label: 'Attendance policy', description: 'Late & LWP rules' },
        { href: '/settings/attendance-regularization', label: 'Regularization', description: 'Employee attendance corrections' },
        { href: '/settings/leave-types', label: 'Leave types', description: 'Time-off categories' },
        { href: '/settings/holidays', label: 'Holidays', description: 'Company holidays' },
        { href: '/settings/commission-rules', label: 'Commission rules', description: 'Sales commissions' },
      ],
    };
  }

  return null;
}

/** Legacy single-link helper — used when no contextual menu applies. */
export function getDefaultSettingsHref(pathname: string | null): string {
  return '/settings';
}
