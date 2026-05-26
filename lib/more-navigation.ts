/**
 * Mobile "More" menu — same section titles and labels as desktop Sidebar,
 * filtered by module permissions and plan features (RBAC).
 */

export type MoreNavItem = {
  href: string;
  label: string;
  /** PBAC module key (see capability-normalizer) */
  module?: string;
  featureKey?: string;
  isLocked?: boolean;
};

export type MoreNavSection = {
  title: string;
  items: MoreNavItem[];
};

export type MoreNavContext = {
  isSupplier: boolean;
  warehousesEnabled: boolean;
  hasCapability: (resource: string, action?: string) => boolean;
};

/** Match Sidebar: hasFeature === hasCapability(featureKey, 'view') */
function hasFeature(
  hasCapability: MoreNavContext['hasCapability'],
  featureKey: string
): boolean {
  return hasCapability(featureKey, 'view');
}

/** Same rules as Sidebar `isItemVisible` */
export function isMoreNavItemVisible(
  item: MoreNavItem,
  ctx: MoreNavContext
): boolean {
  const { hasCapability, warehousesEnabled } = ctx;

  if (!item.module) return true;

  // Match Sidebar: warehouses entry visible when feature is enabled in settings
  if (item.module === 'warehouses' && warehousesEnabled) return true;

  if (
    item.isLocked ||
    (item.featureKey && !hasFeature(hasCapability, item.featureKey))
  ) {
    return true;
  }

  return hasCapability(item.module, 'view');
}

function filterItems(items: MoreNavItem[], ctx: MoreNavContext): MoreNavItem[] {
  return items.filter((i) => isMoreNavItemVisible(i, ctx));
}

function section(
  title: string,
  items: MoreNavItem[],
  ctx: MoreNavContext
): MoreNavSection | null {
  const vis = filterItems(items, ctx);
  if (vis.length === 0) return null;
  return { title, items: vis };
}

/**
 * Build grouped links for /more — titles align with desktop Sidebar.
 */
export function buildMoreMenuSections(ctx: MoreNavContext): MoreNavSection[] {
  const { isSupplier, warehousesEnabled, hasCapability } = ctx;
  const out: MoreNavSection[] = [];

  if (isSupplier) {
    const s = section(
      'Supplier',
      [
        { href: '/suppliers/dashboard', label: 'Supplier Dashboard' },
        { href: '/suppliers/requests', label: 'Requests to Fulfill' },
      ],
      ctx
    );
    if (s) out.push(s);
  }

  const sales = section(
    'Sales',
    [
      { href: '/customers', label: 'Customers', module: 'customers' },
      { href: '/invoices', label: 'All Invoices', module: 'invoices' },
      { href: '/estimates', label: 'Quotations', module: 'invoices' },
      { href: '/sales-orders', label: 'Sales Orders', module: 'invoices' },
      { href: '/delivery-challans', label: 'Delivery Challans', module: 'invoices' },
      { href: '/work-orders', label: 'Work Orders', module: 'work_orders' },
      { href: '/credit-notes', label: 'Credit Notes', module: 'credit_notes' },
      { href: '/debit-notes', label: 'Debit Notes', module: 'debit_notes' },
    ],
    ctx
  );
  if (sales) out.push(sales);

  const purchases = section(
    'Purchases',
    [
      { href: '/suppliers', label: 'Suppliers', module: 'purchases' },
      { href: '/purchases', label: 'All Purchases', module: 'purchases' },
      { href: '/purchases/requests', label: 'Requests', module: 'purchases' },
      { href: '/purchase-orders', label: 'Purchase Orders', module: 'purchases' },
      { href: '/purchase-returns', label: 'Purchase Returns', module: 'purchases' },
      { href: '/expenses', label: 'Expenses', module: 'expenses' },
    ],
    ctx
  );
  if (purchases) out.push(purchases);

  const invItems: MoreNavItem[] = [
    { href: '/items', label: 'Items', module: 'items' },
  ];
  if (hasFeature(hasCapability, 'barcode_label_printing')) {
    invItems.push({
      href: '/items/barcodes',
      label: 'Print Labels',
      module: 'items',
      featureKey: 'barcode_label_printing',
    });
  }
  if (warehousesEnabled) {
    invItems.push({
      href: '/settings/warehouses',
      label: 'Warehouses',
      module: 'warehouses',
      isLocked: !hasFeature(hasCapability, 'multi_warehouse'),
      featureKey: 'settings_multi_warehouse',
    });
    invItems.push({
      href: '/stock-transfers',
      label: 'Stock Transfers',
      module: 'warehouse_transfer',
      isLocked: !hasFeature(hasCapability, 'multi_warehouse'),
      featureKey: 'settings_multi_warehouse',
    });
  }
  invItems.push(
    { href: '/inventory-adjustments', label: 'Adjustments', module: 'items' },
    { href: '/reports/stock/summary', label: 'Stock Summary', module: 'reports' },
    { href: '/reports/stock/closing-stock', label: 'Closing Stock', module: 'reports' }
  );
  const inventory = section('Inventory', invItems, ctx);
  if (inventory) out.push(inventory);

  const accounting = section(
    'Accounting',
    [
      { href: '/accounts', label: 'Chart of Accounts', module: 'settings' },
      { href: '/journal-entries', label: 'Journal Entries', module: 'journal' },
      { href: '/ledger', label: 'Ledger', module: 'invoices' },
      { href: '/payments/in', label: 'Payments In', module: 'payments' },
      { href: '/payments/out', label: 'Payments Out', module: 'payments' },
      { href: '/provisions', label: 'Provisions', module: 'settings' },
      { href: '/tds', label: 'TDS/TCS', module: 'settings' },
    ],
    ctx
  );
  if (accounting) out.push(accounting);

  const reports = section(
    'Reports',
    [
      { href: '/reports', label: 'Overview', module: 'reports' },
      { href: '/reports/builder', label: 'Custom Report Builder', module: 'reports', featureKey: 'report_builder' },
      { href: '/reports/profit-loss', label: 'Profit & Loss', module: 'reports' },
      { href: '/reports/balance-sheet', label: 'Balance Sheet', module: 'reports' },
      { href: '/reports/cash-flow', label: 'Cash Flow', module: 'reports' },
      { href: '/reports/trial-balance', label: 'Trial Balance', module: 'reports' },
      { href: '/reports/aging/receivables', label: 'Receivables Aging', module: 'reports' },
      { href: '/reports/aging/payables', label: 'Payables Aging', module: 'reports' },
      { href: '/reports/gst/gstr1', label: 'GST Returns (GSTR-1)', module: 'reports' },
      { href: '/reports/sales/summary', label: 'Sales — Summary', module: 'reports' },
      { href: '/reports/purchase/summary', label: 'Purchase — Summary', module: 'reports' },
    ],
    ctx
  );
  if (reports) out.push(reports);

  const hr = section(
    'HR & Employees',
    [
      { href: '/employees', label: 'All Employees', module: 'employees' },
      { href: '/employees/new', label: 'Add Employee', module: 'employees' },
      { href: '/employees/attendance', label: 'Attendance', module: 'attendance' },
      { href: '/employees/leaves', label: 'Leaves', module: 'leave_requests' },
      { href: '/employees/salary/payments', label: 'Salary Payments', module: 'payroll' },
      { href: '/employees/commissions', label: 'Commissions', module: 'commissions' },
      { href: '/activity-logs', label: 'Activity Logs', module: 'settings' },
    ],
    ctx
  );
  if (hr) out.push(hr);

  const toolsItems: MoreNavItem[] = [
    { href: '/search', label: 'Search' },
    { href: '/tools', label: 'All Tools' },
    {
      href: '/tools/todo',
      label: 'To Do List',
      featureKey: 'todo',
      isLocked: !hasFeature(hasCapability, 'todo'),
    },
    { href: '/tools/hsn-finder', label: 'HSN/SAC Finder' },
    { href: '/tools/gst-calculator', label: 'GST Calculator' },
    { href: '/tools/google-lead-extractor', label: 'Lead Extractor' },
  ];
  const tools = section('Tools', toolsItems, ctx);
  if (tools) out.push(tools);

  const settingsData = section(
    'Settings & data',
    [
      { href: '/settings', label: 'Settings', module: 'settings' },
      { href: '/settings/users', label: 'Manage Users', module: 'settings' },
      { href: '/settings/backup', label: 'Backup & restore', module: 'settings' },
      { href: '/settings/offline-sync', label: 'Offline sync', module: 'settings' },
    ],
    ctx
  );
  if (settingsData) out.push(settingsData);

  const support = section(
    'Support',
    [
      { href: '/docs', label: 'Documentation' },
      { href: '/support', label: 'Contact Support' },
      { href: '/privacy', label: 'Privacy Policy' },
    ],
    ctx
  );
  if (support) out.push(support);

  return out;
}
