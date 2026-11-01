import { createHash } from 'crypto';
import type { FulfilmentStatus } from '@/lib/fulfilment/rules';

export type StoreFulfillmentStatus = 'confirmed' | 'ready' | 'delivered' | 'cancelled';

/** Shiprocket sends the merchant-configured security token in this header. */
export const SHIPROCKET_WEBHOOK_TOKEN_HEADER = 'x-api-key';

/** Shiprocket accepts an alphanumeric token; 24+ characters keeps it unguessable. */
export function isValidShiprocketWebhookToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9]{24,128}$/.test(token);
}

export function hashStoreWebhookToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function parseShiprocketWebhook(body: Record<string, unknown>): {
  awb: string;
  /** Our reference (`order_id`), never Shiprocket's own id. */
  orderRef: string;
  /** Shiprocket's own order id (`sr_order_id`). */
  srOrderId: string;
  /** True for a return shipment (`is_return` 1, "1" or true). */
  isReturn: boolean;
  qcFailureReason: string | null;
  /** Coarse store order status. */
  status: StoreFulfillmentStatus | null;
  /** Finer delivery status for order_fulfilments. */
  fulfilmentStatus: FulfilmentStatus | null;
  /** A parcel on its way back to the shop (any RTO label except RTO DELIVERED): no status change. */
  rtoInProgress: boolean;
  /** Trimmed, lowercased status label as Shiprocket sent it. */
  label: string;
} {
  const awb = String(body.awb || body.awb_code || '');
  const orderRef = String(body.order_id || '');
  const srOrderId = String(body.sr_order_id || '');
  const isReturn = body.is_return === true || body.is_return === 1 || body.is_return === '1';
  const qcFailureReason = String(body.qc_failure_reason || '').trim() || null;
  const label = String(body.current_status || body.shipment_status || '').trim().toLowerCase();
  const current = label;

  let status: StoreFulfillmentStatus | null = null;
  let fulfilmentStatus: FulfilmentStatus | null = null;
  let rtoInProgress = false;
  // "RTO DELIVERED", "OUT FOR DELIVERY" and "UNDELIVERED" all contain "deliver", so test them first.
  if (current.includes('rto')) {
    // Only the parcel actually reaching the shop is "returned"; until then the bill stays as it is.
    if (/rto[\s_-]*delivered/.test(current)) {
      status = 'cancelled';
      fulfilmentStatus = 'returned';
    } else {
      rtoInProgress = true;
    }
  } else if (current.includes('out for delivery')) {
    status = 'ready';
    fulfilmentStatus = 'out_for_delivery';
  } else if (current.includes('undeliver') || current.includes('failed') || current.includes('attempt')) {
    status = 'ready';
    fulfilmentStatus = 'delivery_failed';
  } else if (current.includes('deliver')) {
    status = 'delivered';
    fulfilmentStatus = 'delivered';
  } else if (current.includes('cancel')) {
    status = 'cancelled';
    fulfilmentStatus = 'cancelled';
  } else if (current.includes('pick') || current.includes('transit') || current.includes('ship')) {
    status = 'ready';
    fulfilmentStatus = 'shipped';
  } else if (current.includes('confirm') || current.includes('new') || current.includes('book')) {
    status = 'confirmed';
    fulfilmentStatus = 'confirmed';
  }

  return { awb, orderRef, srOrderId, isReturn, qcFailureReason, status, fulfilmentStatus, rtoInProgress, label };
}
