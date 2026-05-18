/**
 * Mobile top bar: right-hand “quick settings” target should match the current
 * section (invoice → print/templates, items → labels, etc.), not always generic Settings.
 */
export type MobileQuickSettingsKind =
  | 'app'
  | 'invoice_print'
  | 'items_labels'
  | 'organization'
  | 'warehouses'
  | 'whatsapp';

export function getMobileQuickSettings(pathname: string | null): {
  href: string;
  ariaLabel: string;
  kind: MobileQuickSettingsKind;
} {
  if (!pathname) {
    return { href: '/settings', ariaLabel: 'Settings', kind: 'app' };
  }
  const p = pathname.replace(/\/$/, '') || '/';

  if (p.startsWith('/settings')) {
    return { href: '/settings', ariaLabel: 'Settings', kind: 'app' };
  }

  if (p.startsWith('/whatsapp')) {
    return {
      href: '/settings/whatsapp',
      ariaLabel: 'WhatsApp settings',
      kind: 'whatsapp',
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
      href: '/settings/templates',
      ariaLabel: 'Invoice templates and printing',
      kind: 'invoice_print',
    };
  }

  if (p.startsWith('/items')) {
    return {
      href: '/settings/label-templates',
      ariaLabel: 'Label templates',
      kind: 'items_labels',
    };
  }

  if (p.startsWith('/customers') || p.startsWith('/suppliers')) {
    return {
      href: '/settings/business',
      ariaLabel: 'Business profile',
      kind: 'organization',
    };
  }

  if (
    p.startsWith('/purchases') ||
    p.startsWith('/stock-transfers') ||
    p.startsWith('/inventory-adjustments')
  ) {
    return {
      href: '/settings/warehouses',
      ariaLabel: 'Warehouses and locations',
      kind: 'warehouses',
    };
  }

  if (p.startsWith('/employees')) {
    return { href: '/settings/users', ariaLabel: 'Users and access', kind: 'organization' };
  }

  if (p.startsWith('/reports')) {
    return { href: '/settings', ariaLabel: 'Settings', kind: 'app' };
  }

  return { href: '/settings', ariaLabel: 'Settings', kind: 'app' };
}
