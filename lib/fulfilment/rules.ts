export const FULFILMENT_STATUSES = [
  'new',
  'confirmed',
  'packed',
  'ready_for_pickup',
  'shipped',
  'out_for_delivery',
  'delivered',
  'delivery_failed',
  'returned',
  'cancelled',
] as const;
export type FulfilmentStatus = (typeof FULFILMENT_STATUSES)[number];

export const FULFILMENT_METHODS = ['pickup', 'own_rider', 'shiprocket', 'courier', 'local_app'] as const;
export type FulfilmentMethod = (typeof FULFILMENT_METHODS)[number];

export const FULFILMENT_STATUS_LABEL: Record<FulfilmentStatus, string> = {
  new: 'New',
  confirmed: 'Confirmed',
  packed: 'Packed',
  ready_for_pickup: 'Ready for pickup',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  delivery_failed: 'Delivery failed',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

export const FULFILMENT_METHOD_LABEL: Record<FulfilmentMethod, string> = {
  pickup: 'Customer pickup',
  own_rider: 'Own delivery',
  shiprocket: 'Shiprocket',
  courier: 'Courier',
  local_app: 'Porter / local app',
};

/**
 * Allowed moves. Courier webhooks can skip steps (shipped straight to delivered) and a failed
 * attempt can be retried. Once an order has left the shop it cannot be cancelled, only returned.
 */
export const FULFILMENT_TRANSITIONS: Record<FulfilmentStatus, readonly FulfilmentStatus[]> = {
  new: ['confirmed', 'packed', 'ready_for_pickup', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'],
  confirmed: ['packed', 'ready_for_pickup', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'],
  packed: ['ready_for_pickup', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'],
  ready_for_pickup: ['delivered', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered', 'delivery_failed', 'returned'],
  out_for_delivery: ['delivered', 'delivery_failed', 'returned'],
  delivery_failed: ['out_for_delivery', 'shipped', 'delivered', 'returned'],
  delivered: ['returned'],
  returned: [],
  cancelled: [],
};

/** Goods leave the shop: needs payment or agreed COD. Pickup orders may still pay at the counter. */
const NEEDS_PAYMENT: ReadonlySet<FulfilmentStatus> = new Set(['shipped', 'out_for_delivery']);

export const OPEN_STATUSES: ReadonlySet<FulfilmentStatus> = new Set([
  'new',
  'confirmed',
  'packed',
  'ready_for_pickup',
  'shipped',
  'out_for_delivery',
  'delivery_failed',
]);

export function isFulfilmentStatus(v: unknown): v is FulfilmentStatus {
  return typeof v === 'string' && (FULFILMENT_STATUSES as readonly string[]).includes(v);
}

export function isFulfilmentMethod(v: unknown): v is FulfilmentMethod {
  return typeof v === 'string' && (FULFILMENT_METHODS as readonly string[]).includes(v);
}

export function canTransitionFulfilment(from: string, to: string): boolean {
  if (!isFulfilmentStatus(from) || !isFulfilmentStatus(to)) return false;
  return FULFILMENT_TRANSITIONS[from].includes(to);
}

export function requiresPaymentFor(to: FulfilmentStatus): boolean {
  return NEEDS_PAYMENT.has(to);
}

/** Paid in full, or cash on delivery agreed (the rider collects). */
export function canDispatch(payment: { paid: boolean; codAmount: number }): boolean {
  return payment.paid || payment.codAmount > 0;
}

/** Store order lifecycle (pending/confirmed/ready/delivered/cancelled) onto the shared statuses. */
export function storeStatusToFulfilment(
  storeStatus: string,
  ctx: { deliveryMode?: string | null; dispatchMode?: string | null },
): FulfilmentStatus | null {
  switch (storeStatus) {
    case 'pending':
      return 'new';
    case 'confirmed':
      return 'confirmed';
    case 'ready':
      return ctx.deliveryMode === 'pickup' || ctx.dispatchMode === 'pickup' ? 'ready_for_pickup' : 'shipped';
    case 'delivered':
      return 'delivered';
    case 'cancelled':
      return 'cancelled';
    default:
      return null;
  }
}

export function storeDispatchToMethod(
  deliveryMode: string | null | undefined,
  dispatchMode: string | null | undefined,
): FulfilmentMethod | null {
  if (deliveryMode === 'pickup' || dispatchMode === 'pickup') return 'pickup';
  if (dispatchMode === 'shiprocket') return 'shiprocket';
  if (dispatchMode === 'self') return 'own_rider';
  return null;
}
