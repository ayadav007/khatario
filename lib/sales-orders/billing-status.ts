/** Billing progress for a sales order line (ordered vs already invoiced). */

export type SalesOrderLineQty = {
  id?: string;
  qty?: number | string | null;
  quantity?: number | string | null;
  fulfilled_qty?: number | string | null;
};

export function lineOrderedQty(line: SalesOrderLineQty): number {
  const n = Number(line.qty ?? line.quantity ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function lineFulfilledQty(line: SalesOrderLineQty): number {
  const n = Number(line.fulfilled_qty ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function lineRemainingQty(line: SalesOrderLineQty): number {
  return Math.max(0, lineOrderedQty(line) - lineFulfilledQty(line));
}

/**
 * Order status from line remaining quantities after invoicing.
 * Keeps DB values: confirmed (open), partially_fulfilled, fulfilled (completed).
 */
export function billingStatusFromLines(
  lines: SalesOrderLineQty[],
): 'confirmed' | 'partially_fulfilled' | 'fulfilled' {
  if (lines.length === 0) return 'confirmed';
  let anyInvoiced = false;
  let anyRemaining = false;
  for (const line of lines) {
    const ordered = lineOrderedQty(line);
    if (ordered <= 0) continue;
    const fulfilled = lineFulfilledQty(line);
    if (fulfilled > 0.0001) anyInvoiced = true;
    if (fulfilled + 0.0001 < ordered) anyRemaining = true;
  }
  if (!anyInvoiced) return 'confirmed';
  if (anyRemaining) return 'partially_fulfilled';
  return 'fulfilled';
}

export function isSalesOrderConvertibleStatus(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase();
  return !['cancelled', 'rejected', 'fulfilled'].includes(s);
}
