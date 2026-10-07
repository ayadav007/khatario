const EDITABLE_STATUSES = new Set(['draft', 'confirmed']);

/** Draft/confirmed sales orders with no invoicing started (line or header link). */
export function isSalesOrderEditable(order: {
  status?: string | null;
  converted_invoice_id?: string | null;
  /** True when any line has fulfilled_qty > 0 */
  has_fulfilled_qty?: boolean | null;
}): boolean {
  const status = String(order.status || '').toLowerCase();
  if (!EDITABLE_STATUSES.has(status)) return false;
  if (order.converted_invoice_id) return false;
  if (order.has_fulfilled_qty) return false;
  return true;
}

export function isSalesOrderEditableStatus(status: string | null | undefined): boolean {
  return EDITABLE_STATUSES.has(String(status || '').toLowerCase());
}
