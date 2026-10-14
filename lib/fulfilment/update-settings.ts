/** Buyer WhatsApp updates per delivery status, and the dispatch alert. Client-safe. */

export const NOTIFY_STATUSES = [
  'confirmed',
  'packed',
  'ready_for_pickup',
  'shipped',
  'out_for_delivery',
  'delivered',
  'delivery_failed',
  'cancelled',
] as const;
export type NotifyStatus = (typeof NOTIFY_STATUSES)[number];

export interface OrderUpdateSettings {
  notify: Record<NotifyStatus, boolean>;
  /** Paid orders older than this, not yet dispatched, are flagged and can alert the merchant. */
  dispatchSlaHours: number;
  merchantDispatchAlert: boolean;
  /** Manual bills with a shipping address start delivery tracking on their own. */
  autoTrackShippedBills: boolean;
  /** Tell the buyer once when a shipped parcel has not moved for this many days (0 = off). */
  stuckNoticeDays: number;
}

export const DEFAULT_ORDER_UPDATE_SETTINGS: OrderUpdateSettings = {
  notify: {
    confirmed: true,
    packed: false,
    ready_for_pickup: true,
    shipped: true,
    out_for_delivery: true,
    delivered: true,
    delivery_failed: true,
    cancelled: true,
  },
  dispatchSlaHours: 24,
  merchantDispatchAlert: false,
  autoTrackShippedBills: true,
  stuckNoticeDays: 3,
};

export const NOTIFY_STATUS_HELP: Record<NotifyStatus, string> = {
  confirmed: 'Order number and tracking link',
  packed: 'Packed and leaving soon',
  ready_for_pickup: 'Pickup code and shop address',
  shipped: 'Courier and tracking link',
  out_for_delivery: 'Rider name and phone',
  delivered: 'Bill link',
  delivery_failed: 'Reason and next attempt',
  cancelled: 'Refund amount and timeline',
};

export function sanitizeOrderUpdateSettings(raw: unknown): OrderUpdateSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const notifyRaw = (r.notify && typeof r.notify === 'object' ? r.notify : {}) as Record<string, unknown>;
  const notify = { ...DEFAULT_ORDER_UPDATE_SETTINGS.notify };
  for (const s of NOTIFY_STATUSES) {
    if (typeof notifyRaw[s] === 'boolean') notify[s] = notifyRaw[s] as boolean;
  }
  const hours = Number(r.dispatchSlaHours);
  const stuck = Number(r.stuckNoticeDays);
  return {
    notify,
    dispatchSlaHours: Number.isFinite(hours) && hours >= 1 && hours <= 720 ? Math.round(hours) : 24,
    merchantDispatchAlert: r.merchantDispatchAlert === true,
    autoTrackShippedBills: r.autoTrackShippedBills !== false,
    stuckNoticeDays:
      r.stuckNoticeDays === undefined ? DEFAULT_ORDER_UPDATE_SETTINGS.stuckNoticeDays : Number.isFinite(stuck) && stuck >= 0 && stuck <= 30 ? Math.round(stuck) : 3,
  };
}
