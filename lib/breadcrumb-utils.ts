/**
 * Breadcrumb Utilities
 * Generates breadcrumb paths from route structure
 */

export interface BreadcrumbItem {
  label: string;
  href: string;
}

/**
 * Route metadata for custom breadcrumb labels
 */
const routeMetadata: Record<string, { label: string; parent?: string }> = {
  '/dashboard': { label: 'Dashboard' },
  '/customers': { label: 'Customers' },
  '/customers/new': { label: 'Add Customer', parent: '/customers' },
  '/suppliers': { label: 'Suppliers' },
  '/suppliers/new': { label: 'Add Supplier', parent: '/suppliers' },
  '/items': { label: 'Items' },
  '/items/new': { label: 'Add Item', parent: '/items' },
  '/invoices': { label: 'Invoices' },
  '/invoices/new': { label: 'New Invoice', parent: '/invoices' },
  '/purchases': { label: 'Purchases' },
  '/purchases/new': { label: 'New Purchase', parent: '/purchases' },
  '/expenses': { label: 'Expenses' },
  '/expenses/categories': { label: 'Expense Categories', parent: '/expenses' },
  '/payments/in': { label: 'Payments In' },
  '/payments/out': { label: 'Payments Out' },
  '/accounts': { label: 'Chart of Accounts' },
  '/accounts/new': { label: 'New Account', parent: '/accounts' },
  '/ledger': { label: 'Ledger' },
  '/journal-entries': { label: 'Journal Entries' },
  '/journal-entries/new': { label: 'New Journal Entry', parent: '/journal-entries' },
  '/reports': { label: 'Reports' },
  '/reports/trial-balance': { label: 'Trial Balance', parent: '/reports' },
  '/reports/profit-loss': { label: 'Profit & Loss', parent: '/reports' },
  '/reports/balance-sheet': { label: 'Balance Sheet', parent: '/reports' },
  '/reports/profit-by-invoice': { label: 'Profit by invoice', parent: '/reports' },
  '/reports/deleted': { label: 'Deleted items', parent: '/reports' },
  '/pricing': { label: 'Pricing', parent: '/dashboard' },
  '/pricing/party-item': { label: 'Party item prices', parent: '/pricing' },
  '/settings': { label: 'Settings' },
  '/employees': { label: 'Employees' },
  '/employees/new': { label: 'Add Employee', parent: '/employees' },
  '/tds': { label: 'TDS Management' },
  '/tds/categories': { label: 'TDS Categories', parent: '/tds' },
  '/tds/transactions': { label: 'TDS Transactions', parent: '/tds' },
  '/tds/payments': { label: 'TDS Payments', parent: '/tds' },
  '/tds/certificates': { label: 'TDS Certificates', parent: '/tds' },
};

/**
 * Generate breadcrumbs from pathname
 */
export function generateBreadcrumbs(pathname: string, customLabels?: Record<string, string>): BreadcrumbItem[] {
  const breadcrumbs: BreadcrumbItem[] = [
    { label: 'Home', href: '/dashboard' }
  ];

  // Check if we have metadata for this exact route
  if (routeMetadata[pathname]) {
    const metadata = routeMetadata[pathname];
    
    // Add parent if specified
    if (metadata.parent && routeMetadata[metadata.parent]) {
      breadcrumbs.push({
        label: routeMetadata[metadata.parent].label,
        href: metadata.parent
      });
    }
    
    // Add current page
    breadcrumbs.push({
      label: customLabels?.[pathname] || metadata.label,
      href: pathname
    });
    
    return breadcrumbs;
  }

  // Fallback: parse pathname segments
  const segments = pathname.split('/').filter(Boolean);
  let currentPath = '';

  for (let i = 0; i < segments.length; i++) {
    currentPath += `/${segments[i]}`;
    
    // Skip if it's a dynamic segment (UUID)
    if (segments[i].match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      // Try to get label from customLabels or use a generic label
      const label = customLabels?.[currentPath] || 'Details';
      breadcrumbs.push({ label, href: currentPath });
      continue;
    }

    // Check if we have metadata for this path
    if (routeMetadata[currentPath]) {
      breadcrumbs.push({
        label: customLabels?.[currentPath] || routeMetadata[currentPath].label,
        href: currentPath
      });
    } else {
      // Generate label from segment
      const label = segments[i]
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      breadcrumbs.push({
        label: customLabels?.[currentPath] || label,
        href: currentPath
      });
    }
  }

  return breadcrumbs;
}

