/**
 * Where tapping a notification should take the user. Notifications store what they are
 * about (`type`, `reference_type`, `reference_id`) rather than a URL; this maps them to a page.
 * Returns null when there is nothing to open.
 */
export type NotificationRef = {
  type?: unknown;
  reference_type?: unknown;
  reference_id?: unknown;
  actionUrl?: unknown;
};

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

export function notificationHref(n: NotificationRef): string | null {
  const explicit = str(n.actionUrl);
  if (explicit) return explicit;

  const type = str(n.type);
  const refType = str(n.reference_type);
  const refId = str(n.reference_id);
  const id = refId ? encodeURIComponent(refId) : null;

  // Supplier Hub
  if (refType === 'supply_order' && id) return `/supply-orders/${id}`;
  if (refType === 'supplier_collection') return '/purchases/new-arrivals';
  if (type === 'hub_connection_request') return '/suppliers/hub';
  if (type === 'hub_connection_accepted') return '/suppliers';
  if (type === 'hub_connection_declined') return '/suppliers/hub/find';
  if (type === 'low_stock_alert') return '/supply-orders?role=vendor';
  if (refType === 'business') return '/suppliers';

  if (type === 'supplier_request') return '/suppliers/hub';
  if (refType === 'supplier' && id) return `/suppliers/${id}`;
  if (type === 'invoice_nearing_due' || type === 'invoice_overdue') return id ? `/invoices/${id}` : '/invoices';
  if (refType === 'invoice' && id) return `/invoices/${id}`;
  if (type === 'todo_reminder') return '/tools/todo';
  if (type === 'store_enquiry') return '/settings/online-store/enquiries';
  if (refType === 'khata_customer' && id) return `/customers/${id}`;
  if (refType === 'khata_order') return '/settings/online-store/orders?khata=pending';
  if (type === 'gst_compliance') return '/reports/gst/compliance';
  if (refType === 'whatsapp_conversation' && id) return `/whatsapp/conversations?c=${id}`;
  return null;
}
