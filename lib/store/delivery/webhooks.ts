export type StoreFulfillmentStatus = 'confirmed' | 'ready' | 'delivered' | 'cancelled';

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
