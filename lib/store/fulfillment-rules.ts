export function canBookShipment(paymentStatus: string): boolean {
  return paymentStatus === 'paid' || paymentStatus === 'cod';
}

/**
 * Checkout does not deduct stock. COD and Razorpay both wait for the final invoice,
 * which is the only actual deduction. There is no reservation hold.
 */
export function shouldDecrementStockOnPlace(_paymentMethod: 'cod' | 'online' | 'razorpay'): boolean {
  return false;
}

/**
 * Cancelling a store order does not add shelf quantity back.
 * An uninvoiced order never took stock. An invoiced order is reversed through the
 * invoice stock movement (`invoice_cancel`), not through `current_stock += qty`.
 */
export function shouldRestoreStockOnCancel(_paymentStatus: string): boolean {
  return false;
}

export const STORE_ORDER_STATUSES = ['pending', 'confirmed', 'ready', 'delivered', 'cancelled'] as const;
export type StoreOrderStatus = (typeof STORE_ORDER_STATUSES)[number];

export const STORE_ORDER_TRANSITIONS: Record<StoreOrderStatus, readonly StoreOrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export function isStoreOrderStatus(value: unknown): value is StoreOrderStatus {
  return typeof value === 'string' && (STORE_ORDER_STATUSES as readonly string[]).includes(value);
}

export function canTransitionStoreOrder(from: string, to: string): boolean {
  if (!isStoreOrderStatus(from) || !isStoreOrderStatus(to)) return false;
  return STORE_ORDER_TRANSITIONS[from].includes(to);
}

export interface StoreCartLine {
  item_id: string;
  variant_id?: string;
  quantity: number;
}

/** Storefront quantities are whole units (the cart only steps by 1); anything else is rejected, not rounded. */
export function validateStoreOrderLines(
  raw: unknown,
): { ok: true; lines: StoreCartLine[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'Cart is empty' };
  }
  const lines: StoreCartLine[] = [];
  for (const entry of raw) {
    const line = entry as { item_id?: unknown; variant_id?: unknown; quantity?: unknown } | null;
    if (!line || typeof line.item_id !== 'string' || !line.item_id) {
      return { ok: false, error: 'Each item needs an item_id' };
    }
    const qty = line.quantity;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty <= 0) {
      return { ok: false, error: 'Quantity must be a whole number greater than zero' };
    }
    lines.push({
      item_id: line.item_id,
      variant_id: typeof line.variant_id === 'string' && line.variant_id ? line.variant_id : undefined,
      quantity: qty,
    });
  }
  return { ok: true, lines };
}

/** Exact match in paise; partial and over-payments both need a human to look at them. */
export function storePaymentAmountMatches(
  paidInr: number | null | undefined,
  expectedInr: number,
): boolean {
  if (paidInr == null || !Number.isFinite(paidInr) || !Number.isFinite(expectedInr)) return false;
  return Math.round(paidInr * 100) === Math.round(expectedInr * 100);
}
