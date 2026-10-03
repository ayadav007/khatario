import { getPool, queryOne, queryRows } from '@/lib/db';
import { loadShiprocketCreds } from '@/lib/store/delivery';
import {
  createShiprocketClient,
  shiprocketTrackingUrl,
  type ShiprocketClient,
  type ShiprocketParcel,
} from '@/lib/store/delivery/shiprocket';
import { loadOrderLines, loadShipTo, type HubSource } from './hub';
import { canTransitionFulfilment, type FulfilmentStatus } from './rules';
import type { FulfilmentChange } from './service';

export const DEFAULT_PARCEL_WEIGHT_KG = 0.5;

export type ShiprocketBookResult =
  | {
      ok: true;
      awb: string;
      courierName: string;
      trackingUrl: string;
      pickupScheduledAt: string | null;
      /** Booked, but pickup could not be requested; the merchant can request it in Shiprocket. */
      warning?: string;
    }
  | {
      ok: false;
      code: 'NOT_CONFIGURED' | 'NOT_FOUND' | 'NO_ADDRESS' | 'NO_PINCODE' | 'NO_PHONE' | 'BOOKING_FAILED';
      error: string;
    };

interface BookingRow {
  id: string;
  business_id: string;
  seq: number;
  status: FulfilmentStatus;
  store_order_id: string | null;
  sales_order_id: string | null;
  invoice_id: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  awb: string | null;
  partner_name: string | null;
  tracking_url: string | null;
  pickup_scheduled_at: string | null;
  cod_amount: string;
  cod_collected_at: string | null;
  ship_address: string | null;
  ship_pincode: string | null;
  weight_kg: string | null;
  carrier_order_id: string | null;
  carrier_shipment_id: string | null;
  order_number: string | null;
  amount: string | null;
  buyer_email: string | null;
}

function sourceOf(row: Pick<BookingRow, 'store_order_id' | 'sales_order_id' | 'invoice_id'>): { source: HubSource; id: string } {
  if (row.store_order_id) return { source: 'store_order', id: row.store_order_id };
  if (row.sales_order_id) return { source: 'sales_order', id: row.sales_order_id };
  return { source: 'invoice', id: row.invoice_id as string };
}

async function loadBookingRow(businessId: string, fulfilmentId: string): Promise<BookingRow | null> {
  return queryOne<BookingRow>(
    `SELECT f.id, f.business_id, f.seq, f.status, f.store_order_id, f.sales_order_id, f.invoice_id,
            f.buyer_name, f.buyer_phone, f.awb, f.partner_name, f.tracking_url, f.pickup_scheduled_at,
            f.cod_amount::text, f.cod_collected_at, f.ship_address, f.ship_pincode, f.weight_kg::text,
            f.carrier_order_id, f.carrier_shipment_id,
            COALESCE(so.order_number, s.order_number, i.invoice_number) AS order_number,
            COALESCE(so.grand_total, s.grand_total, i.grand_total)::text AS amount,
            COALESCE(so.customer_email, c.email) AS buyer_email
       FROM order_fulfilments f
       LEFT JOIN store_orders so ON so.id = f.store_order_id AND so.business_id = f.business_id
       LEFT JOIN sales_orders s ON s.id = f.sales_order_id AND s.business_id = f.business_id
       LEFT JOIN invoices i ON i.id = f.invoice_id AND i.business_id = f.business_id
       LEFT JOIN customers c ON c.id = f.customer_id AND c.business_id = f.business_id
      WHERE f.id = $1 AND f.business_id = $2`,
    [fulfilmentId, businessId],
  );
}

/** Shiprocket sends local Indian time as "YYYY-MM-DD HH:MM:SS"; anything else is dropped. */
function istTimestamp(v: string | null | undefined): string | null {
  const m = (v ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?/);
  return m ? `${m[1]}T${m[2]}${m[3] ?? ':00'}+05:30` : null;
}

/** What Shiprocket needs for this parcel, or the reason it cannot be booked yet. */
async function buildShiprocketParcel(
  businessId: string,
  row: BookingRow,
): Promise<{ ok: true; parcel: ShiprocketParcel } | { ok: false; code: 'NO_ADDRESS' | 'NO_PINCODE' | 'NO_PHONE'; error: string }> {
  const { source, id } = sourceOf(row);
  const shipTo = row.ship_address && row.ship_pincode ? null : await loadShipTo(businessId, source, id);
  const address = (row.ship_address || shipTo?.address || '').trim();
  const pincode = (row.ship_pincode || shipTo?.pincode || '').replace(/\D/g, '');
  if (!address) return { ok: false, code: 'NO_ADDRESS', error: 'Add the delivery address before booking a courier' };
  if (pincode.length !== 6) return { ok: false, code: 'NO_PINCODE', error: 'Add a 6-digit PIN code before booking a courier' };
  const phone = (row.buyer_phone ?? '').replace(/\D/g, '');
  if (phone.length < 10) return { ok: false, code: 'NO_PHONE', error: "The buyer's 10-digit phone number is needed for the courier" };

  const orderNumber = row.order_number || row.id.slice(0, 8);
  const amount = Number(row.amount) || 0;
  const codDue = row.cod_collected_at ? 0 : Number(row.cod_amount) || 0;
  const ref = row.seq > 1 ? `${orderNumber}-P${row.seq}` : orderNumber;

  let items: ShiprocketParcel['items'];
  if (row.seq > 1) {
    items = [{ name: `Order ${orderNumber} (parcel ${row.seq})`, units: 1, price: codDue || amount }];
  } else {
    const lines = await loadOrderLines(businessId, source, id);
    items = lines
      .filter((l) => Number(l.quantity) > 0)
      .map((l) => {
        const units = Math.max(1, Math.round(Number(l.quantity)));
        return { name: l.name || 'Item', units, price: (Number(l.amount) || 0) / units };
      });
    if (items.length === 0) items = [{ name: `Order ${orderNumber}`, units: 1, price: amount }];
  }

  return {
    ok: true,
    parcel: {
      ref,
      buyerName: row.buyer_name || 'Customer',
      buyerPhone: phone,
      buyerEmail: row.buyer_email,
      address,
      pincode,
      items,
      subTotal: codDue > 0 ? codDue : amount,
      cod: codDue > 0,
      weightKg: Number(row.weight_kg) || DEFAULT_PARCEL_WEIGHT_KG,
    },
  };
}

async function shiprocketClientFor(businessId: string): Promise<ShiprocketClient | null> {
  const creds = await loadShiprocketCreds(businessId);
  return creds ? createShiprocketClient(creds) : null;
}

export async function isShiprocketConfigured(businessId: string): Promise<boolean> {
  return (await loadShiprocketCreds(businessId)) !== null;
}

/**
 * Books one parcel with Shiprocket: order, courier + AWB, pickup. Saves Shiprocket's ids even on a
 * partial failure so the next attempt continues instead of creating a duplicate order. Store
 * orders get the AWB mirrored back so store screens and webhooks keep matching. Does not change
 * the delivery status; the caller moves it to shipped.
 */
export async function bookFulfilmentWithShiprocket(
  businessId: string,
  fulfilmentId: string,
  opts: { client?: ShiprocketClient; actorUserId?: string | null } = {},
): Promise<ShiprocketBookResult> {
  const row = await loadBookingRow(businessId, fulfilmentId);
  if (!row) return { ok: false, code: 'NOT_FOUND', error: 'Delivery record not found' };
  if (row.awb && row.carrier_shipment_id) {
    return {
      ok: true,
      awb: row.awb,
      courierName: row.partner_name ?? 'Shiprocket',
      trackingUrl: row.tracking_url ?? shiprocketTrackingUrl(row.awb),
      pickupScheduledAt: row.pickup_scheduled_at,
    };
  }
  const client = opts.client ?? (await shiprocketClientFor(businessId));
  if (!client) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      error: 'Connect Shiprocket first: Settings → Online store → Delivery, add the Shiprocket API user.',
    };
  }
  const built = await buildShiprocketParcel(businessId, row);
  if (!built.ok) return built;

  const booked = await client.book(built.parcel, { orderId: row.carrier_order_id, shipmentId: row.carrier_shipment_id });
  const partner = booked.courierName ? `${booked.courierName} (Shiprocket)` : null;

  const pool = getPool();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `UPDATE order_fulfilments
          SET carrier_order_id = COALESCE($3, carrier_order_id),
              carrier_shipment_id = COALESCE($4, carrier_shipment_id),
              awb = COALESCE($5, awb),
              partner_name = COALESCE($6, partner_name),
              tracking_url = COALESCE($7, tracking_url),
              pickup_scheduled_at = COALESCE($8::timestamptz, pickup_scheduled_at),
              method = 'shiprocket',
              booking_error = $9,
              label_url = CASE WHEN $5::text IS NOT NULL THEN NULL ELSE label_url END,
              updated_at = NOW()
        WHERE id = $1 AND business_id = $2`,
      [
        row.id,
        businessId,
        booked.orderId ?? null,
        booked.shipmentId ?? null,
        booked.ok ? booked.awb : null,
        booked.ok ? partner : null,
        booked.ok ? booked.trackingUrl : null,
        istTimestamp(booked.pickupScheduledAt),
        booked.error ? booked.error.slice(0, 500) : null,
      ],
    );
    if (booked.ok) {
      await c.query(
        `INSERT INTO order_fulfilment_events (fulfilment_id, business_id, status, note, actor_type, actor_user_id)
         VALUES ($1, $2, $3, $4, 'staff', $5)`,
        [row.id, businessId, row.status, `Booked with ${partner} · AWB ${booked.awb}`.slice(0, 500), opts.actorUserId ?? null],
      );
    }
    if (row.store_order_id && (booked.shipmentId || booked.awb)) {
      await c.query(
        `UPDATE store_orders
            SET shipment_id = COALESCE($3, shipment_id),
                carrier_order_id = COALESCE($4, carrier_order_id),
                awb = COALESCE($5, awb),
                tracking_url = COALESCE($6, tracking_url),
                courier_name = COALESCE($7, courier_name),
                delivery_provider = 'shiprocket',
                dispatch_mode = 'shiprocket',
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND business_id = $2`,
        [
          row.store_order_id,
          businessId,
          booked.shipmentId ?? null,
          booked.orderId ?? null,
          booked.ok ? booked.awb : null,
          booked.ok ? booked.trackingUrl : null,
          booked.ok ? booked.courierName : null,
        ],
      );
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }

  if (!booked.ok || !booked.awb) {
    return { ok: false, code: 'BOOKING_FAILED', error: booked.error || 'Shiprocket booking failed' };
  }
  return {
    ok: true,
    awb: booked.awb,
    courierName: booked.courierName ?? 'Shiprocket',
    trackingUrl: booked.trackingUrl ?? shiprocketTrackingUrl(booked.awb),
    pickupScheduledAt: booked.pickupScheduledAt ?? null,
    ...(booked.error ? { warning: `Booked, but pickup was not requested: ${booked.error}` } : {}),
  };
}

/** Shiprocket's label PDF for a booked parcel; cached on the parcel after the first call. */
export async function shiprocketLabelUrl(
  businessId: string,
  fulfilmentId: string,
  opts: { client?: ShiprocketClient } = {},
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const row = await queryOne<{ carrier_shipment_id: string | null; awb: string | null; label_url: string | null }>(
    `SELECT carrier_shipment_id, awb, label_url FROM order_fulfilments WHERE id = $1 AND business_id = $2`,
    [fulfilmentId, businessId],
  );
  if (!row) return { ok: false, error: 'Delivery record not found' };
  if (row.label_url) return { ok: true, url: row.label_url };
  if (!row.carrier_shipment_id || !row.awb) return { ok: false, error: 'Book the courier through Shiprocket first' };
  const client = opts.client ?? (await shiprocketClientFor(businessId));
  if (!client) return { ok: false, error: 'Shiprocket is not connected' };
  try {
    const url = await client.label([row.carrier_shipment_id]);
    await getPool().query(
      `UPDATE order_fulfilments SET label_url = $3, updated_at = NOW() WHERE id = $1 AND business_id = $2`,
      [fulfilmentId, businessId, url],
    );
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Label could not be created' };
  }
}

const MANIFEST_SCOPE = (branchParam: string | null) =>
  branchParam ? `AND (f.branch_id IS NULL OR f.branch_id = ANY(${branchParam}::uuid[]))` : '';

/** Booked Shiprocket parcels still waiting for a manifest (the courier's pickup sheet). */
export async function pendingManifestCount(businessId: string, branchIds: string[] | null): Promise<number> {
  const params: unknown[] = [businessId];
  if (branchIds) params.push(branchIds);
  const r = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM order_fulfilments f
      WHERE f.business_id = $1 AND f.method = 'shiprocket' AND f.status = 'shipped'
        AND f.awb IS NOT NULL AND f.carrier_shipment_id IS NOT NULL AND f.manifest_url IS NULL
        ${MANIFEST_SCOPE(branchIds ? '$2' : null)}`,
    params,
  );
  return r?.n ?? 0;
}

/**
 * One manifest for every booked parcel not yet on one. With nothing pending, returns today's last
 * manifest so it can be printed again.
 */
export async function generateShiprocketManifest(
  businessId: string,
  branchIds: string[] | null,
  opts: { client?: ShiprocketClient } = {},
): Promise<{ ok: true; url: string; count: number; reprint: boolean } | { ok: false; error: string; status: number }> {
  const params: unknown[] = [businessId];
  if (branchIds) params.push(branchIds);
  const scope = MANIFEST_SCOPE(branchIds ? '$2' : null);
  const pending = await queryRows<{ id: string; carrier_shipment_id: string; carrier_order_id: string | null }>(
    `SELECT f.id, f.carrier_shipment_id, f.carrier_order_id FROM order_fulfilments f
      WHERE f.business_id = $1 AND f.method = 'shiprocket' AND f.status = 'shipped'
        AND f.awb IS NOT NULL AND f.carrier_shipment_id IS NOT NULL AND f.manifest_url IS NULL ${scope}
      ORDER BY f.shipped_at NULLS LAST
      LIMIT 200`,
    params,
  );
  if (pending.length === 0) {
    const last = await queryOne<{ manifest_url: string }>(
      `SELECT f.manifest_url FROM order_fulfilments f
        WHERE f.business_id = $1 AND f.manifest_url IS NOT NULL
          AND f.manifested_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' ${scope}
        ORDER BY f.manifested_at DESC LIMIT 1`,
      params,
    );
    if (last) return { ok: true, url: last.manifest_url, count: 0, reprint: true };
    return { ok: false, status: 404, error: 'No Shiprocket parcels are waiting for a manifest' };
  }
  const client = opts.client ?? (await shiprocketClientFor(businessId));
  if (!client) return { ok: false, status: 409, error: 'Shiprocket is not connected' };
  try {
    const url = await client.manifest(
      pending.map((p) => p.carrier_shipment_id),
      pending.map((p) => p.carrier_order_id).filter((v): v is string => Boolean(v)),
    );
    await getPool().query(
      `UPDATE order_fulfilments SET manifest_url = $3, manifested_at = NOW(), updated_at = NOW()
        WHERE business_id = $1 AND id = ANY($2::uuid[])`,
      [businessId, pending.map((p) => p.id), url],
    );
    return { ok: true, url, count: pending.length, reprint: false };
  } catch (e) {
    return { ok: false, status: 502, error: e instanceof Error ? e.message : 'Manifest could not be created' };
  }
}

/**
 * Cancels a Shiprocket booking that has not been picked up yet and puts the parcel back to packed,
 * so it can be re-booked with a corrected address or weight. Not for store orders, whose cancel
 * goes through the store lifecycle.
 */
export async function cancelShiprocketBooking(
  businessId: string,
  fulfilmentId: string,
  opts: { client?: ShiprocketClient; actorUserId?: string | null } = {},
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const row = await queryOne<{
    status: FulfilmentStatus;
    store_order_id: string | null;
    carrier_order_id: string | null;
  }>(
    `SELECT status, store_order_id, carrier_order_id FROM order_fulfilments WHERE id = $1 AND business_id = $2`,
    [fulfilmentId, businessId],
  );
  if (!row) return { ok: false, status: 404, error: 'Delivery record not found' };
  if (row.store_order_id) return { ok: false, status: 409, error: 'Cancel store orders from the order itself' };
  if (!row.carrier_order_id) return { ok: false, status: 409, error: 'There is no Shiprocket booking on this parcel' };
  if (row.status !== 'shipped' && row.status !== 'packed' && row.status !== 'confirmed') {
    return { ok: false, status: 409, error: 'The courier already has this parcel; it can no longer be cancelled here' };
  }
  const client = opts.client ?? (await shiprocketClientFor(businessId));
  if (!client) return { ok: false, status: 409, error: 'Shiprocket is not connected' };
  try {
    await client.cancelOrders([row.carrier_order_id]);
  } catch (e) {
    return { ok: false, status: 502, error: e instanceof Error ? e.message : 'Shiprocket could not cancel the booking' };
  }
  const back: FulfilmentStatus = row.status === 'shipped' ? 'packed' : row.status;
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `UPDATE order_fulfilments
          SET status = $3::varchar, awb = NULL, tracking_url = NULL, partner_name = NULL,
              carrier_order_id = NULL, carrier_shipment_id = NULL, label_url = NULL,
              manifest_url = NULL, manifested_at = NULL, pickup_scheduled_at = NULL, booking_error = NULL,
              shipped_at = CASE WHEN $3::varchar = 'packed' THEN NULL ELSE shipped_at END,
              status_changed_at = CASE WHEN status <> $3::varchar THEN NOW() ELSE status_changed_at END,
              updated_at = NOW()
        WHERE id = $1 AND business_id = $2`,
      [fulfilmentId, businessId, back],
    );
    await c.query(
      `INSERT INTO order_fulfilment_events (fulfilment_id, business_id, status, note, actor_type, actor_user_id)
       VALUES ($1, $2, $3, 'Shiprocket booking cancelled', 'staff', $4)`,
      [fulfilmentId, businessId, back, opts.actorUserId ?? null],
    );
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  return { ok: true };
}

/**
 * Tracking update for a parcel booked from the Orders screen (WhatsApp, manual, B2B). Store orders
 * are handled by the store lifecycle first; this only matches parcels without a store order.
 */
export async function applyShiprocketFulfilmentUpdate(input: {
  businessId: string;
  awb: string;
  orderRef: string;
  fulfilmentStatus: FulfilmentStatus | null;
}): Promise<{ outcome: 'not_found' | 'unchanged' | 'updated'; fulfilment?: FulfilmentChange }> {
  if (!input.fulfilmentStatus || (!input.awb && !input.orderRef)) return { outcome: 'not_found' };
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    const found = await c.query<{ id: string; status: FulfilmentStatus }>(
      `SELECT id, status FROM order_fulfilments
        WHERE business_id = $1 AND store_order_id IS NULL AND method = 'shiprocket'
          AND (($2 <> '' AND awb = $2) OR ($3 <> '' AND carrier_order_id = $3))
        ORDER BY ($2 <> '' AND awb = $2) DESC, created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [input.businessId, input.awb, input.orderRef],
    );
    const row = found.rows[0];
    if (!row) {
      await c.query('ROLLBACK');
      return { outcome: 'not_found' };
    }
    const to = input.fulfilmentStatus;
    if (row.status === to || !canTransitionFulfilment(row.status, to)) {
      await c.query('ROLLBACK');
      return { outcome: 'unchanged' };
    }
    await c.query(
      `UPDATE order_fulfilments
          SET status = $3::varchar, status_changed_at = NOW(),
              shipped_at = CASE WHEN $3::varchar = 'shipped' AND shipped_at IS NULL THEN NOW() ELSE shipped_at END,
              delivered_at = CASE WHEN $3::varchar = 'delivered' THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
              failure_reason = CASE WHEN $3::varchar = 'delivery_failed' THEN 'Courier could not deliver' ELSE failure_reason END,
              updated_at = NOW()
        WHERE id = $1 AND business_id = $2`,
      [row.id, input.businessId, to],
    );
    await c.query(
      `INSERT INTO order_fulfilment_events (fulfilment_id, business_id, status, note, actor_type)
       VALUES ($1, $2, $3, 'Courier update', 'webhook')`,
      [row.id, input.businessId, to],
    );
    await c.query('COMMIT');
    return { outcome: 'updated', fulfilment: { fulfilmentId: row.id, to } };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
