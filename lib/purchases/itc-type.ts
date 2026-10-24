export type PurchaseItcType = 'inputs' | 'capital_goods' | 'input_services';

/**
 * itc_type stored on purchase_items for GSTR-9 Table 6 / 8. Capital goods must be flagged on the
 * line (itc_type, line_item_type or is_capital_goods); nothing else can tell a machine from stock.
 * Returns null when unflagged so the GSTR-9 classifier falls back to item type and HSN.
 */
export function purchaseLineItcType(
  item: { itc_type?: unknown; line_item_type?: unknown; is_capital_goods?: unknown },
  lineIntent: 'goods' | 'service'
): PurchaseItcType | null {
  const explicit = String(item.itc_type ?? '').trim();
  if (explicit === 'inputs' || explicit === 'capital_goods' || explicit === 'input_services') {
    if (explicit === 'capital_goods' && lineIntent === 'service') return 'input_services';
    return explicit;
  }
  if (lineIntent === 'goods' && (item.line_item_type === 'capital_goods' || item.is_capital_goods === true)) {
    return 'capital_goods';
  }
  return null;
}
