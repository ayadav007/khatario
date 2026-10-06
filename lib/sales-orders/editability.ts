const EDITABLE_STATUSES = new Set(['draft', 'confirmed']);

/** Draft/confirmed sales orders that have not been converted to an invoice. */
export function isSalesOrderEditable(order: {
  status?: string | null;
  converted_invoice_id?: string | null;
}): boolean {
  const status = String(order.status || '').toLowerCase();
  if (!EDITABLE_STATUSES.has(status)) return false;
  if (order.converted_invoice_id) return false;
  return true;
}

export function isSalesOrderEditableStatus(status: string | null | undefined): boolean {
  return EDITABLE_STATUSES.has(String(status || '').toLowerCase());
}
