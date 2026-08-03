/**
 * Mobile back targets for routes reached from the /more menu.
 * Back from a section list page returns to /more with that section expanded.
 */

export const MORE_SECTION_QUERY_KEY = 'section';

function normalizePath(pathname: string): string {
  return pathname.replace(/\/$/, '') || '/';
}

/** Menu href → More accordion section title (longest match wins). */
const MORE_MENU_ROUTES: { href: string; section: string }[] = [
  // Supplier
  { href: '/suppliers/dashboard', section: 'Supplier' },
  { href: '/suppliers/requests', section: 'Supplier' },
  // Sales (tab roots /customers /invoices omitted — no back on those list pages)
  { href: '/estimates', section: 'Sales' },
  { href: '/sales-orders', section: 'Sales' },
  { href: '/delivery-challans', section: 'Sales' },
  { href: '/work-orders', section: 'Sales' },
  { href: '/credit-notes', section: 'Sales' },
  { href: '/debit-notes', section: 'Sales' },
  // Purchases
  { href: '/suppliers', section: 'Purchases' },
  { href: '/purchases/requests', section: 'Purchases' },
  { href: '/purchase-orders', section: 'Purchases' },
  { href: '/purchase-returns', section: 'Purchases' },
  { href: '/purchases', section: 'Purchases' },
  { href: '/expenses', section: 'Purchases' },
  // Inventory
  { href: '/items/barcodes', section: 'Inventory' },
  { href: '/settings/warehouses', section: 'Inventory' },
  { href: '/stock-transfers', section: 'Inventory' },
  { href: '/inventory-adjustments', section: 'Inventory' },
  { href: '/reports/stock/closing-stock', section: 'Inventory' },
  { href: '/reports/stock/summary', section: 'Inventory' },
  // Accounting
  { href: '/journal-entries', section: 'Accounting' },
  { href: '/accounts', section: 'Accounting' },
  { href: '/ledger', section: 'Accounting' },
  { href: '/payments/in', section: 'Accounting' },
  { href: '/payments/out', section: 'Accounting' },
  { href: '/provisions', section: 'Accounting' },
  { href: '/tds', section: 'Accounting' },
  // Reports
  { href: '/reports/builder', section: 'Reports' },
  { href: '/reports/profit-loss', section: 'Reports' },
  { href: '/reports/balance-sheet', section: 'Reports' },
  { href: '/reports/cash-flow', section: 'Reports' },
  { href: '/reports/trial-balance', section: 'Reports' },
  { href: '/reports/aging/receivables', section: 'Reports' },
  { href: '/reports/aging/payables', section: 'Reports' },
  { href: '/reports/gst/gstr1', section: 'Reports' },
  { href: '/reports/sales/summary', section: 'Reports' },
  { href: '/reports/purchase/summary', section: 'Reports' },
  { href: '/reports', section: 'Reports' },
  // HR & Employees (longer paths before /employees)
  { href: '/employees/salary/payments', section: 'HR & Employees' },
  { href: '/employees/salary/advances', section: 'HR & Employees' },
  { href: '/employees/salary/payslips', section: 'HR & Employees' },
  { href: '/employees/attendance', section: 'HR & Employees' },
  { href: '/employees/leaves', section: 'HR & Employees' },
  { href: '/employees/commissions', section: 'HR & Employees' },
  { href: '/employees/expenses', section: 'HR & Employees' },
  { href: '/employees/performance', section: 'HR & Employees' },
  { href: '/employees/targets', section: 'HR & Employees' },
  { href: '/employees/tasks', section: 'HR & Employees' },
  { href: '/employees/new', section: 'HR & Employees' },
  { href: '/employees', section: 'HR & Employees' },
  { href: '/activity-logs', section: 'HR & Employees' },
  // Tools
  { href: '/tools/todo', section: 'Tools' },
  { href: '/tools/hsn-finder', section: 'Tools' },
  { href: '/tools/gst-calculator', section: 'Tools' },
  { href: '/tools/google-lead-extractor', section: 'Tools' },
  { href: '/tools', section: 'Tools' },
  { href: '/search', section: 'Tools' },
  // Settings & data
  { href: '/settings/users', section: 'Settings & data' },
  { href: '/settings/backup', section: 'Settings & data' },
  { href: '/settings/offline-sync', section: 'Settings & data' },
  { href: '/settings', section: 'Settings & data' },
  // Support
  { href: '/docs', section: 'Support' },
  { href: '/support', section: 'Support' },
  { href: '/privacy', section: 'Support' },
];

const SORTED_MORE_ROUTES = [...MORE_MENU_ROUTES].sort((a, b) => b.href.length - a.href.length);

export function moreMenuHrefForSection(sectionTitle: string): string {
  return `/more?${MORE_SECTION_QUERY_KEY}=${encodeURIComponent(sectionTitle)}`;
}

/** Longest matching More menu href for this pathname, if any. */
export function findMoreMenuRoute(pathname: string): { href: string; section: string } | null {
  const p = normalizePath(pathname);
  for (const route of SORTED_MORE_ROUTES) {
    if (p === route.href || p.startsWith(`${route.href}/`)) {
      return route;
    }
  }
  return null;
}

/** True when pathname is exactly a More menu link (not a deeper drill-down). */
export function isMoreMenuListRoute(pathname: string): boolean {
  const p = normalizePath(pathname);
  return SORTED_MORE_ROUTES.some((r) => r.href === p);
}

/**
 * Back href for routes under the More menu.
 * List pages → /more?section=… ; nested pages → parent path.
 */
export function getMoreMenuBackHref(pathname: string | null): string | null {
  if (!pathname) return null;
  const p = normalizePath(pathname);
  const match = findMoreMenuRoute(p);
  if (!match) return null;

  if (p === match.href) {
    return moreMenuHrefForSection(match.section);
  }

  // Composer suffixes handled by getMobileBackHref before this helper is called.
  const parent = p.split('/').filter(Boolean).slice(0, -1).join('/');
  const parentPath = parent ? `/${parent}` : '/';
  if (parentPath === match.href || findMoreMenuRoute(parentPath)?.href === match.href) {
    return parentPath;
  }

  return parentPath;
}
