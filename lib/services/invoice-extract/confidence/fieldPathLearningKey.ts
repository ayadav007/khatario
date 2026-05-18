/**
 * Map extract field paths to `invoice_field_learning.field_name` keys (item.* namespace).
 */
export function fieldPathToLearningKey(fieldPath: string): string | null {
  const m = /^items\.(\d+)\.(.+)$/.exec(fieldPath);
  if (!m) return null;

  const sub = m[2];

  /** Keys align with `summarizeInvoiceCorrectionDelta` item_field_changes. */
  const map: Record<string, string> = {
    qty: 'quantity',
    rate: 'unit_price',
    line_total: 'amount',
    gst_rate: 'tax_rate',
    description: 'item_name',
    hsn_code: 'hsn_sac',
  };

  const k = map[sub];
  return k ? `item.${k}` : null;
}
