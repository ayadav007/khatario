import { randomBytes } from 'crypto';
import type { PoolClient } from 'pg';
import { getPool, queryOne, queryRows } from '@/lib/db';
import { getAppPublicOrigin } from '@/lib/customer-surface/urls';
import { loadParcelContents, type ParcelLine } from './parcel-items';
import { markCodCollected, transitionFulfilment, type FulfilmentChange } from './service';
import type { FulfilmentMethod, FulfilmentStatus } from './rules';

/**
 * Rider link: the shop's own rider (or a Porter / Dunzo driver) opens one page with the drop details
 * and taps Out for delivery, Delivered, Couldn't deliver or Cash collected. No Khatario login: the
 * random rider_token is the key, and it only works while the parcel is on the road.
 */

export const RIDER_METHODS: FulfilmentMethod[] = ['own_rider', 'local_app', 'courier'];
const ON_THE_ROAD: FulfilmentStatus[] = ['shipped', 'out_for_delivery', 'delivery_failed'];

export function isRiderToken(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{24,48}$/.test(v);
}

export function riderUrl(token: string): string {
  return `${getAppPublicOrigin()}/r/${encodeURIComponent(token)}`;
}

/** The parcel's rider token, created on first use. */
export async function ensureRiderToken(client: PoolClient, businessId: string, fulfilmentId: string): Promise<string | null> {
  const fresh = randomBytes(24).toString('base64url');
  const r = await client.query<{ rider_token: string }>(
    `UPDATE order_fulfilments SET rider_token = COALESCE(rider_token, $3), updated_at = NOW()
      WHERE id = $1 AND business_id = $2
      RETURNING rider_token`,
    [fulfilmentId, businessId, fresh],
  );
  return r.rows[0]?.rider_token ?? null;
}

/** WhatsApp text the shop forwards to the rider. */
export function riderMessage(d: {
  orderNumber: string;
  buyerName: string | null;
  buyerPhone: string | null;
  address: string | null;
  pincode: string | null;
  codDue: number;
  url: string;
}): string {
  const lines = [
    `Delivery: order ${d.orderNumber}`,
    d.buyerName ? `Customer: ${d.buyerName}${d.buyerPhone ? ` (${d.buyerPhone})` : ''}` : null,
    d.address ? `Address: ${d.address}${d.pincode ? `, PIN ${d.pincode}` : ''}` : null,
    d.codDue > 0 ? `Collect cash: ₹${d.codDue.toLocaleString('en-IN')}` : 'Prepaid, no cash to collect',
    `Update status here: ${d.url}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export type RiderDrop = {
  shop: { name: string; phone: string | null };
  orderNumber: string;
  seq: number;
  status: FulfilmentStatus;
  buyerName: string | null;
  buyerPhone: string | null;
  address: string | null;
  pincode: string | null;
  packages: number;
  codDue: number;
  codCollected: boolean;
  items: ParcelLine[];
  canUpdate: boolean;
};

type DropRow = {
  id: string;
  business_id: string;
  seq: number;
  status: FulfilmentStatus;
  store_order_id: string | null;
  sales_order_id: string | null;
  invoice_id: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  ship_address: string | null;
  ship_pincode: string | null;
  packages: number;
  cod_amount: string;
  cod_collected_at: string | null;
  order_number: string | null;
  shop_name: string;
  shop_phone: string | null;
};

async function findDrop(token: string): Promise<DropRow | null> {
  if (!isRiderToken(token)) return null;
  return queryOne<DropRow>(
    `SELECT f.id, f.business_id, f.seq, f.status, f.store_order_id, f.sales_order_id, f.invoice_id,
            f.buyer_name, f.buyer_phone, f.ship_address, f.ship_pincode, f.packages,
            f.cod_amount::text, f.cod_collected_at,
            COALESCE(so.order_number, s.order_number, i.invoice_number) AS order_number,
            b.name AS shop_name, b.phone AS shop_phone
       FROM order_fulfilments f
       JOIN businesses b ON b.id = f.business_id
       LEFT JOIN store_orders so ON so.id = f.store_order_id
       LEFT JOIN sales_orders s ON s.id = f.sales_order_id
       LEFT JOIN invoices i ON i.id = f.invoice_id
      WHERE f.rider_token = $1`,
    [token],
  );
}

export async function loadRiderDrop(token: string): Promise<RiderDrop | null> {
  const f = await findDrop(token);
  if (!f) return null;
  const source = f.store_order_id
    ? ({ kind: 'store_order', id: f.store_order_id } as const)
    : f.sales_order_id
      ? ({ kind: 'sales_order', id: f.sales_order_id } as const)
      : ({ kind: 'invoice', id: f.invoice_id as string } as const);
  const siblings = await queryRows<{ id: string; seq: number; status: string }>(
    `SELECT id, seq, status FROM order_fulfilments
      WHERE business_id = $1
        AND store_order_id IS NOT DISTINCT FROM $2::uuid
        AND sales_order_id IS NOT DISTINCT FROM $3::uuid
        AND invoice_id IS NOT DISTINCT FROM $4::uuid`,
    [f.business_id, f.store_order_id, f.sales_order_id, f.invoice_id],
  );
  const contents = await loadParcelContents(getPool(), f.business_id, source, siblings);
  const codDue = f.cod_collected_at ? 0 : Number(f.cod_amount) || 0;
  return {
    shop: { name: f.shop_name, phone: f.shop_phone },
    orderNumber: f.order_number || f.id.slice(0, 8),
    seq: f.seq,
    status: f.status,
    buyerName: f.buyer_name,
    buyerPhone: f.buyer_phone,
    address: f.ship_address,
    pincode: f.ship_pincode,
    packages: f.packages,
    codDue,
    codCollected: Boolean(f.cod_collected_at),
    items: contents.get(f.id) ?? [],
    canUpdate: ON_THE_ROAD.includes(f.status),
  };
}

export type RiderAction = 'out_for_delivery' | 'delivered' | 'delivery_failed' | 'cod_collected';

export function isRiderAction(v: unknown): v is RiderAction {
  return v === 'out_for_delivery' || v === 'delivered' || v === 'delivery_failed' || v === 'cod_collected';
}

export type RiderUpdateResult =
  | { ok: true; change: FulfilmentChange; businessId: string; storeOrderId: string | null; to: FulfilmentStatus | null }
  | { ok: false; status: number; error: string };

/** A rider's tap. Delivered on a COD parcel needs the cash marked collected first (or in the same tap). */
export async function applyRiderUpdate(
  token: string,
  p: {
    action: RiderAction;
    reason?: string | null;
    cashCollected?: boolean;
    /** Store orders post the cash receipt on their bill before the parcel is marked paid. */
    onStoreCash?: (storeOrderId: string, businessId: string) => Promise<void>;
  },
): Promise<RiderUpdateResult> {
  const f = await findDrop(token);
  if (!f) return { ok: false, status: 404, error: 'This link is not valid' };
  if (!ON_THE_ROAD.includes(f.status)) {
    return { ok: false, status: 409, error: `This parcel is already ${f.status.replace(/_/g, ' ')}` };
  }
  const takesCash =
    !f.cod_collected_at && Number(f.cod_amount) > 0 && (p.action === 'cod_collected' || (p.action === 'delivered' && p.cashCollected));
  if (takesCash && f.store_order_id && p.onStoreCash) {
    try {
      await p.onStoreCash(f.store_order_id, f.business_id);
    } catch (e) {
      return { ok: false, status: 409, error: e instanceof Error ? e.message : 'Cash could not be recorded' };
    }
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    let change: FulfilmentChange = null;
    let to: FulfilmentStatus | null = null;
    const codDue = f.cod_collected_at ? 0 : Number(f.cod_amount) || 0;

    if (p.action === 'cod_collected' || (p.action === 'delivered' && p.cashCollected && codDue > 0)) {
      await markCodCollected(client, { businessId: f.business_id, fulfilmentId: f.id, actorType: 'rider' });
    } else if (p.action === 'delivered' && codDue > 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: `Collect ₹${codDue.toLocaleString('en-IN')} cash before marking delivered` };
    }

    if (p.action !== 'cod_collected') {
      to = p.action;
      const moved = await transitionFulfilment(client, {
        businessId: f.business_id,
        fulfilmentId: f.id,
        to,
        actorType: 'rider',
        note: p.action === 'delivery_failed' ? p.reason?.slice(0, 300) || 'Rider could not deliver' : 'Updated by rider',
        details: p.action === 'delivery_failed' ? { failureReason: p.reason?.slice(0, 500) || 'Rider could not deliver' } : {},
        skipPaymentGate: true,
      });
      if (!moved.ok) {
        await client.query('ROLLBACK');
        return { ok: false, status: moved.status, error: moved.error };
      }
      change = moved.changed ? { fulfilmentId: f.id, to: moved.to } : null;
    }
    await client.query('COMMIT');
    return { ok: true, change, businessId: f.business_id, storeOrderId: f.store_order_id, to };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
