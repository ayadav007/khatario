import { createHash } from 'crypto';

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
  orderRef: string;
  status: StoreFulfillmentStatus | null;
} {
  const awb = String(body.awb || body.awb_code || '');
  const orderRef = String(body.order_id || body.sr_order_id || '');
  const current = String(body.current_status || body.shipment_status || '').toLowerCase();

  let status: StoreFulfillmentStatus | null = null;
  if (current.includes('deliver')) status = 'delivered';
  else if (current.includes('cancel') || current.includes('rto')) status = 'cancelled';
  else if (current.includes('pick') || current.includes('transit') || current.includes('ship')) {
    status = 'ready';
  } else if (current.includes('confirm') || current.includes('new') || current.includes('book')) {
    status = 'confirmed';
  }

  return { awb, orderRef, status };
}
