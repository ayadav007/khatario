/**
 * Human-readable titles for the mobile top bar (center).
 * When this returns null, the layout shows the business name instead.
 * Match most specific paths first (handled by order of checks).
 */
export function getMobileRouteTitle(pathname: string | null): string | null {
  if (!pathname) return null;
  const p = pathname.replace(/\/$/, '') || '/';

  // —— Core nav (BottomNav) ——
  if (p === '/dashboard') return 'Home';
  if (p === '/invoices') return 'Invoices';
  if (p === '/items') return 'Items';
  if (p === '/customers') return 'Parties';
  if (p === '/more') return 'More';

  // —— Invoices ——
  if (p === '/invoices/new') return 'Create bill / invoice';
  if (p.startsWith('/invoices/')) {
    if (p.endsWith('/view')) return 'View invoice';
    if (p.endsWith('/edit')) return 'Edit invoice';
    return 'Invoice';
  }

  // —— Items ——
  if (p === '/items/new') return 'Create item';
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
  if (p.startsWith('/suppliers/')) {
    if (p.endsWith('/edit')) return 'Edit supplier';
    return 'Supplier';
  }

  // —— Purchases & stock ——
  if (p === '/purchases/scan-record') return 'Scan & Record Bills';
  if (p.startsWith('/purchases')) return p.includes('/new') ? 'New purchase' : 'Purchases';
  if (p.startsWith('/purchase-orders')) return 'Purchase orders';
  if (p.startsWith('/purchase-returns')) return 'Purchase returns';
  if (p.startsWith('/stock-transfers')) return 'Stock transfers';
  if (p.startsWith('/inventory-adjustments')) return 'Stock adjustment';
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
  if (p.startsWith('/accounts')) return 'Accounts';
  if (p.startsWith('/journal-entries')) return 'Journal';
  if (p.startsWith('/expenses')) return 'Expenses';
  if (p.startsWith('/opening-balances')) return 'Opening balances';

  // —— Employees & HR ——
  if (p.startsWith('/employees')) return 'Employees';

  // —— Reports & tools ——
  if (p.startsWith('/reports')) return 'Reports';
  if (p.startsWith('/tools')) return 'Tools';

  // —— WhatsApp ——
  if (p.startsWith('/whatsapp')) return 'WhatsApp';

  // —— Settings ——
  if (p.startsWith('/settings')) return 'Settings';

  // —— Credit & approvals ——
  if (p.startsWith('/credit-approvals')) return 'Credit approvals';

  // —— TDS ——
  if (p.startsWith('/tds')) return 'TDS';

  if (p.startsWith('/search')) return 'Search';

  return null;
}
