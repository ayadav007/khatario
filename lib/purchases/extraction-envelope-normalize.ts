import { round2, roundRetailQty, roundExclusiveUnitPrice } from '@/lib/numeric-precision';

/**
 * Canonical numeric rounding for extraction payloads (shared by review modal / inline purchase fill).
 */
export function normalizeExtractionEnvelope(payload: any): any {
  if (!payload?.data || typeof payload.data !== 'object') return payload;
  const data = payload.data;

  const items = Array.isArray(data.items)
    ? data.items.map((it: Record<string, unknown>) => {
        const amount = it.amount;
        return {
          ...it,
          quantity: roundRetailQty(Number(it.quantity) || 0),
          unit_price: roundExclusiveUnitPrice(Number(it.unit_price) || 0),
          amount:
            typeof amount === 'number' && Number.isFinite(amount)
              ? amount !== 0
                ? round2(amount)
                : amount
              : amount,
          discount_amount: round2(Number(it.discount_amount) || 0),
          discount_percent: round2(Number(it.discount_percent) || 0),
          tax_rate: round2(Number(it.tax_rate) || 0),
        };
      })
    : data.items;

  let totals = data.totals;
  if (totals && typeof totals === 'object') {
    totals = { ...totals };
    for (const key of [
      'subtotal',
      'cgst',
      'sgst',
      'igst',
      'tax_amount',
      'grand_total',
      'total',
      'round_off',
    ] as const) {
      const v = (totals as Record<string, unknown>)[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        (totals as Record<string, unknown>)[key] = round2(v);
      }
    }
    const gs = (totals as Record<string, unknown>).gst_summary;
    if (Array.isArray(gs)) {
      (totals as Record<string, unknown>).gst_summary = gs.map((row: unknown) =>
        row && typeof row === 'object'
          ? {
              ...(row as object),
              gst_rate: round2(Number((row as Record<string, unknown>).gst_rate) || 0),
              taxable_value: round2(Number((row as Record<string, unknown>).taxable_value) || 0),
              cgst: round2(Number((row as Record<string, unknown>).cgst) || 0),
              sgst: round2(Number((row as Record<string, unknown>).sgst) || 0),
              igst: round2(Number((row as Record<string, unknown>).igst) || 0),
              total_tax: round2(Number((row as Record<string, unknown>).total_tax) || 0),
            }
          : row
      );
    }
  }

  return { ...payload, data: { ...data, items, totals } };
}
