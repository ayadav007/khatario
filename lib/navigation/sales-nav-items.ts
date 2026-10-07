/**
 * Shared Sales nav items — keep desktop Sidebar and mobile More in sync.
 */

export type SalesNavItemDef = {
  href: string;
  label: string;
  module?: string;
};

/** Same order/labels as Sidebar Sales (agents use invoices module for order lookups). */
export const SALES_NAV_ITEMS: SalesNavItemDef[] = [
  { href: '/customers', label: 'Customers', module: 'customers' },
  { href: '/invoices', label: 'All Invoices', module: 'invoices' },
  { href: '/orders', label: 'Orders & Delivery', module: 'invoices' },
  { href: '/estimates', label: 'Quotations', module: 'invoices' },
  { href: '/sales-orders', label: 'Sales Orders', module: 'invoices' },
  { href: '/delivery-challans', label: 'Delivery Challans', module: 'invoices' },
  { href: '/work-orders', label: 'Work Orders', module: 'work_orders' },
  { href: '/credit-notes', label: 'Credit Notes', module: 'credit_notes' },
  { href: '/debit-notes', label: 'Debit Notes', module: 'debit_notes' },
];

/** Lookup routes Connect agents may use without a full Billing product enabled. */
export const CONNECT_AGENT_LOOKUP_HREFS = [
  '/customers',
  '/invoices',
  '/orders',
  '/estimates',
  '/sales-orders',
  '/delivery-challans',
  '/items',
  '/pricing/party-item',
] as const;

export function isConnectAgentLookupPath(pathname: string): boolean {
  const path = pathname.split('?')[0];
  return CONNECT_AGENT_LOOKUP_HREFS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}
