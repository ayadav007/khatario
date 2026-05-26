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

function hasEditQuery(search: string | URLSearchParams | null | undefined): boolean {
  const edit = getQueryParam(search, 'edit');
  return !!edit?.trim();
}

/**
 * Human-readable titles for the mobile top bar (center).
 * When this returns null, the layout shows the business name instead.
 * Match most specific paths first (handled by order of checks).
 *
 * Pass `search` (query string or URLSearchParams) for composer routes that use `?edit=id`.
 */
export function getMobileRouteTitle(
  pathname: string | null,
  search?: string | URLSearchParams | null
): string | null {
  if (!pathname) return null;
  const p = pathname.replace(/\/$/, '') || '/';
  const isEdit = hasEditQuery(search);
  // —— Core nav (BottomNav) ——
  if (p === '/dashboard') return 'Home';
  if (p === '/invoices') return 'Invoices';
  if (p === '/items') return 'Items';
  if (p === '/customers') return 'Parties';
  if (p === '/more') return 'More';

  // —— Invoices ——
  if (p === '/invoices/new') return isEdit ? 'Edit invoice' : 'New invoice';
  if (p.startsWith('/invoices/')) {
    if (p.endsWith('/view')) return 'View invoice';
    if (p.endsWith('/edit')) return 'Edit invoice';
    return 'Invoice';
  }

  // —— Items ——
  if (p === '/items/new') return isEdit ? 'Edit item' : 'Create item';
  if (p.startsWith('/items/')) {
    if (p.includes('/edit')) return 'Edit item';
    if (p.endsWith('/barcodes')) return 'Barcodes';
    if (p.includes('/categories')) return 'Categories';
    return 'Item';
  }

  // —— Customers (Parties) ——
  if (p === '/customers/new') return 'Create party';
  if (p.startsWith('/customers/')) {
    if (p.endsWith('/edit')) return 'Edit party';
    if (p.endsWith('/statement')) return 'Statement';
    return 'Party';
  }

  // —— Suppliers ——
  if (p === '/suppliers') return 'Suppliers';
  if (p === '/suppliers/new') return 'Create supplier';
  if (p === '/suppliers/hub') return 'Suppliers hub';
  if (p.startsWith('/suppliers/hub/')) return 'Hub profile';
  if (p === '/suppliers/requests') return 'Requests to fulfill';
  if (p.startsWith('/suppliers/')) {
    if (p.endsWith('/edit')) return 'Edit supplier';
    return 'Supplier';
  }

  // —— Purchases & stock ——
  if (p === '/purchases/scan-record') return 'Scan & Record Bills';
  if (p === '/purchases/requests') return 'Purchase requests';
  if (p.startsWith('/purchases/') && !p.endsWith('/new')) return 'Purchase';
  if (p === '/purchases/new') return 'New purchase';
  if (p === '/purchases') return 'Purchases';
  if (p.startsWith('/purchase-orders')) return 'Purchase orders';
  if (p.startsWith('/purchase-returns/')) return 'Purchase return';
  if (p === '/purchase-returns') return 'Purchase returns';
  if (p.endsWith('/receive') && p.startsWith('/stock-transfers/')) return 'Receive transfer';
  if (p.startsWith('/stock-transfers/')) return 'Stock transfer';
  if (p === '/stock-transfers') return 'Stock transfers';
  if (p === '/inventory-adjustments/new') return 'New adjustment';
  if (p.startsWith('/inventory-adjustments/')) return 'Adjustment';
  if (p === '/inventory-adjustments') return 'Adjustments';
  if (p.startsWith('/delivery-challans')) return 'Delivery challan';

  // —— Sales ——
  if (p.startsWith('/sales-orders')) return p.includes('/new') ? 'New sales order' : 'Sales orders';
  if (p.startsWith('/estimates')) return 'Estimates';
  if (p.startsWith('/credit-notes')) return 'Credit note';
  if (p.startsWith('/debit-notes')) return 'Debit note';
  if (p.startsWith('/work-orders')) return 'Work order';

  // —— Payments & accounts ——
  if (p.startsWith('/payments/in')) return 'Payments in';
  if (p.startsWith('/payments/out')) return 'Payments out';
  if (p.startsWith('/payments')) return 'Payments';
  if (p.startsWith('/accounts/') && p.endsWith('/reconciliation')) return 'Reconciliation';
  if (p.startsWith('/accounts/')) return 'Account';
  if (p === '/accounts') return 'Accounts';
  if (p.startsWith('/journal-entries/')) return 'Journal entry';
  if (p === '/journal-entries') return 'Journal';
  if (p.startsWith('/ledger/account/')) return 'Ledger account';
  if (p === '/ledger') return 'Ledger';
  if (p.startsWith('/expenses')) return 'Expenses';
  if (p === '/opening-balances/setup') return 'Opening balances';
  if (p.startsWith('/opening-balances')) return 'Opening balances';

  // —— Employees & HR ——
  if (p === '/employees/attendance/mark') return 'Mark attendance';
  if (p === '/employees/expenses/new') return 'Submit expense';
  if (p === '/employees/leaves/new') return 'Request leave';
  if (p === '/employees/tasks/new') return 'Create task';
  if (p === '/employees/salary/advances/new') return 'Request advance';
  if (p === '/employees/salary/payments/new') return 'Process payment';
  if (p.startsWith('/employees/')) return 'Employee';
  if (p === '/employees') return 'Employees';

  // —— Reports (specific titles before generic) ——
  if (p === '/reports') return 'Reports';
  if (p === '/reports/profit-loss') return 'Profit & Loss';
  if (p === '/reports/profit-loss/validation') return 'P&L validation';
  if (p === '/reports/balance-sheet') return 'Balance sheet';
  if (p === '/reports/trial-balance') return 'Trial balance';
  if (p === '/reports/cash-flow') return 'Cash flow';
  if (p === '/reports/credit-risk') return 'Credit risk';
  if (p === '/reports/profit-by-invoice') return 'Profit by invoice';
  if (p.startsWith('/reports/gst/gstr1')) return 'GSTR-1';
  if (p.startsWith('/reports/gst/gstr3b')) return 'GSTR-3B';
  if (p.startsWith('/reports/gst/gstr9')) return 'GSTR-9';
  if (p.startsWith('/reports/gst/gstr2b')) return 'GSTR-2B';
  if (p.startsWith('/reports/gst')) return 'GST report';
  if (p.startsWith('/reports/sales')) return 'Sales report';
  if (p.startsWith('/reports/purchase')) return 'Purchase report';
  if (p.startsWith('/reports/stock')) return 'Stock report';
  if (p.startsWith('/reports/aging')) return 'Aging report';
  if (p.startsWith('/reports')) return 'Report';
  if (p.startsWith('/tools')) return 'Tools';

  // —— WhatsApp ——
  if (p === '/whatsapp/dashboard') return 'CRM dashboard';
  if (p.startsWith('/whatsapp/campaigns/')) return 'Campaign';
  if (p.startsWith('/whatsapp')) return 'WhatsApp';

  // —— Settings ——
  if (p === '/settings/backup') return 'Backup & restore';
  if (p === '/settings/offline-sync') return 'Offline sync';
  if (p === '/settings/custom-fields') return 'Custom fields';
  if (p === '/settings/branches/new') return 'Create branch';
  if (p.startsWith('/settings/branches/') && p.endsWith('/edit')) return 'Edit branch';
  if (p.startsWith('/settings')) return 'Settings';

  // —— Credit & approvals ——
  if (p.startsWith('/credit-approvals')) return 'Credit approvals';

  // —— TDS ——
  if (p.startsWith('/tds')) return 'TDS';

  if (p.startsWith('/search')) return 'Search';

  return null;
}
