import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { cleanDimCm, cleanWeightKg } from '@/lib/fulfilment/service';
import { loadShipTo, type HubSource } from '@/lib/fulfilment/hub';
import { loadShiprocketCreds } from '@/lib/store/delivery';
import {
  createShiprocketClient,
  shiprocketTrackingUrl,
  tenDigitPhone,
  type ShiprocketClient,
  type ShiprocketReturnParcel,
} from '@/lib/store/delivery/shiprocket';
import { recordReturnEvent } from './events';
import { notifyMerchantReturn } from './notify';
import { canMovePickupStatus, parseShiprocketReturnStatus } from './pickup-status';
import { RETURN_REASON_LABELS, type PickupStatus, type ReturnReason } from './labels';

/**
 * Courier pickup of a returned parcel through Shiprocket: where the parcel is collected, the
 * package size, booking and cancelling. The return-side twin of lib/fulfilment/shiprocket-booking.ts.
 */

type Db = Pick<PoolClient, 'query'>;

export const DEFAULT_RETURN_WEIGHT_KG = 0.5;
export const DEFAULT_RETURN_SIDE_CM = 10;

export type PickupDetails = {
  address?: string | null;
  pincode?: string | null;
  phone?: string | null;
  weightKg?: number | null;
  lengthCm?: number | null;
  breadthCm?: number | null;
  heightCm?: number | null;
};

const NOT_CONNECTED =
  'Connect Shiprocket first: Settings → Integrations → Shiprocket, add the Shiprocket API user.';

const LIVE_PICKUP: PickupStatus[] = ['booked', 'out_for_pickup', 'pickup_issue'];

/** A pickup that Shiprocket is still holding and that can still be cancelled. */
export function hasLivePickup(row: { pickup_status: PickupStatus | null; carrier_order_id: string | null }): boolean {
  return Boolean(row.carrier_order_id) && row.pickup_status !== null && LIVE_PICKUP.includes(row.pickup_status);
}

const clean = (v: string | null | undefined, max: number): string | null => (v ?? '').trim().slice(0, max) || null;

type ReturnLinks = {
  invoice_id: string;
  fulfilment_id: string | null;
  store_order_id: string | null;
  sales_order_id: string | null;
  customer_id: string | null;
};

type OrderDefaults = {
  address: string | null;
  pincode: string | null;
  phone: string | null;
  weightKg: number | null;
  lengthCm: number | null;
  breadthCm: number | null;
  heightCm: number | null;
};

/**
 * What the original order knows: the parcel's address, PIN and buyer phone, then the order's own
 * address and the customer's phone. Weight and size come from the parcel only when every line of
 * the bill is in this return (a part return is a different box).
 */
async function orderDefaults(db: Db, businessId: string, returnId: string, r: ReturnLinks): Promise<OrderDefaults> {
  const parcel = r.fulfilment_id
    ? (
        await db.query<{
          ship_address: string | null;
          ship_pincode: string | null;
          buyer_phone: string | null;
          weight_kg: string | null;
          length_cm: string | null;
          breadth_cm: string | null;
          height_cm: string | null;
        }>(
          `SELECT ship_address, ship_pincode, buyer_phone, weight_kg::text, length_cm::text, breadth_cm::text, height_cm::text
             FROM order_fulfilments WHERE id = $1 AND business_id = $2`,
          [r.fulfilment_id, businessId],
        )
      ).rows[0]
    : undefined;

  let address = clean(parcel?.ship_address, 500);
  let pincode = (parcel?.ship_pincode ?? '').replace(/\D/g, '').slice(0, 6) || null;
  if (!address || !pincode) {
    const source: HubSource = r.store_order_id ? 'store_order' : r.sales_order_id ? 'sales_order' : 'invoice';
    const shipTo = await loadShipTo(businessId, source, r.store_order_id ?? r.sales_order_id ?? r.invoice_id);
    address = address ?? clean(shipTo.address, 500);
    pincode = pincode ?? ((shipTo.pincode ?? '').replace(/\D/g, '').slice(0, 6) || null);
  }

  let phone = (parcel?.buyer_phone ?? '').replace(/\D/g, '').slice(0, 15) || null;
  if (!phone) {
    const c = await db.query<{ phone: string | null }>(
      `SELECT COALESCE(NULLIF(TRIM(c.phone), ''), NULLIF(TRIM(so.customer_phone), '')) AS phone
         FROM order_returns r
         LEFT JOIN customers c ON c.id = r.customer_id AND c.business_id = r.business_id
         LEFT JOIN store_orders so ON so.id = r.store_order_id AND so.business_id = r.business_id
        WHERE r.id = $1 AND r.business_id = $2`,
      [returnId, businessId],
    );
    phone = (c.rows[0]?.phone ?? '').replace(/\D/g, '').slice(0, 15) || null;
  }

  const whole = await db.query<{ whole: boolean }>(
    `SELECT COALESCE(BOOL_AND(COALESCE(rq.qty, 0) >= ii.quantity - 0.000001), false) AS whole
       FROM invoice_items ii
       LEFT JOIN (SELECT invoice_item_id, SUM(quantity) AS qty FROM order_return_items WHERE return_id = $1 GROUP BY invoice_item_id) rq
         ON rq.invoice_item_id = ii.id
      WHERE ii.invoice_id = $2`,
    [returnId, r.invoice_id],
  );
  const useParcelSize = Boolean(whole.rows[0]?.whole) && parcel != null;
  return {
    address,
    pincode,
    phone,
    weightKg: useParcelSize ? cleanWeightKg(parcel?.weight_kg) : null,
    lengthCm: useParcelSize ? cleanDimCm(parcel?.length_cm) : null,
    breadthCm: useParcelSize ? cleanDimCm(parcel?.breadth_cm) : null,
    heightCm: useParcelSize ? cleanDimCm(parcel?.height_cm) : null,
  };
}

async function loadLinks(db: Db, businessId: string, returnId: string): Promise<(ReturnLinks & Record<string, unknown>) | null> {
  const r = await db.query(
    `SELECT invoice_id, fulfilment_id, store_order_id, sales_order_id, customer_id,
            pickup_address, pickup_pincode, pickup_phone,
            pickup_weight_kg::text, pickup_length_cm::text, pickup_breadth_cm::text, pickup_height_cm::text,
            carrier_order_id, awb
       FROM order_returns WHERE id = $1 AND business_id = $2`,
    [returnId, businessId],
  );
  return r.rows[0] ?? null;
}

/**
 * Drops a half-made Shiprocket order (created, but no AWB yet) so the next booking creates a new
 * one with the next reference (RET-0001-2). Returns the abandoned Shiprocket order id, which the
 * caller cancels in Shiprocket after its transaction commits (`cancelAbandonedOrder`), or null
 * when there was nothing to abandon. A booked return (with an AWB) is left alone: that one is
 * cancelled with `cancelReturnPickup`.
 */
export async function abandonHalfMadeOrder(db: Db, businessId: string, returnId: string): Promise<string | null> {
  const r = await db.query<{ carrier_order_id: string | null }>(
    `UPDATE order_returns r
        SET carrier_order_id = NULL, carrier_shipment_id = NULL, pickup_attempt = pickup_attempt + 1,
            pickup_error = NULL, updated_at = NOW()
       FROM (SELECT id, carrier_order_id FROM order_returns WHERE id = $1 AND business_id = $2 FOR UPDATE) old
      WHERE r.id = old.id AND r.awb IS NULL AND (r.carrier_order_id IS NOT NULL OR r.carrier_shipment_id IS NOT NULL)
      RETURNING old.carrier_order_id`,
    [returnId, businessId],
  );
  return r.rows[0] ? (r.rows[0].carrier_order_id ?? '') || null : null;
}

/**
 * Best-effort cancel of an order `abandonHalfMadeOrder` gave up on. Run outside any transaction.
 * Never throws: a failure comes back as text for the caller to log or show.
 */
export async function cancelAbandonedOrder(
  businessId: string,
  orderId: string,
  opts: { client?: ShiprocketClient } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const client = opts.client ?? (await shiprocketClientFor(businessId));
    if (!client) return { ok: false, error: 'Shiprocket is not connected' };
    await client.cancelOrders([orderId]);
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Shiprocket could not cancel the earlier order';
    console.warn(`[returns] could not cancel abandoned Shiprocket order ${orderId}: ${error}`);
    return { ok: false, error };
  }
}

/** Where the parcel is collected and how big it is, as saved on the return (or as it would be saved). */
export type ResolvedPickupDetails = {
  address: string | null;
  pincode: string | null;
  phone: string | null;
  weightKg: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
};

/**
 * The pickup details `details` would leave on the return: blanks are filled from what was already
 * saved, then the original order (see `orderDefaults`), then 0.5 kg and 10 cm sides.
 */
async function resolvePickupDetails(
  db: Db,
  businessId: string,
  returnId: string,
  details?: PickupDetails | null,
): Promise<{ saved: ReturnLinks & Record<string, unknown>; values: ResolvedPickupDetails } | null> {
  const saved = await loadLinks(db, businessId, returnId);
  if (!saved) return null;
  const defaults = await orderDefaults(db, businessId, returnId, saved);
  const d = details ?? {};
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
  const savedNum = (k: string) => num(saved[k]);

  const address = clean(d.address, 500) ?? clean(saved.pickup_address as string | null, 500) ?? defaults.address;
  const pincode =
    (d.pincode ?? '').replace(/\D/g, '').slice(0, 6) ||
    (saved.pickup_pincode as string | null) ||
    defaults.pincode;
  const phone =
    (d.phone ?? '').replace(/\D/g, '').slice(0, 15) || (saved.pickup_phone as string | null) || defaults.phone;
  const weight = cleanWeightKg(d.weightKg) ?? cleanWeightKg(savedNum('pickup_weight_kg')) ?? defaults.weightKg ?? DEFAULT_RETURN_WEIGHT_KG;
  const side = (given: number | null | undefined, savedKey: string, fromParcel: number | null) =>
    cleanDimCm(given) ?? cleanDimCm(savedNum(savedKey)) ?? fromParcel ?? DEFAULT_RETURN_SIDE_CM;

  return {
    saved,
    values: {
      address,
      pincode: pincode || null,
      phone: phone || null,
      weightKg: weight,
      lengthCm: side(d.lengthCm, 'pickup_length_cm', defaults.lengthCm),
      breadthCm: side(d.breadthCm, 'pickup_breadth_cm', defaults.breadthCm),
      heightCm: side(d.heightCm, 'pickup_height_cm', defaults.heightCm),
    },
  };
}

/** What the approve form starts with: the saved pickup details, else what approving would save. Writes nothing. */
export async function pickupDetailsFor(db: Db, businessId: string, returnId: string): Promise<ResolvedPickupDetails | null> {
  return (await resolvePickupDetails(db, businessId, returnId, null))?.values ?? null;
}

/**
 * Saves where the parcel is collected and how big it is (see `resolvePickupDetails` for how blanks
 * are filled). A phone or PIN is stored as given; booking checks them.
 *
 * When the address, PIN, phone or package differ from what a half-made Shiprocket order (no AWB yet)
 * was created with, that order is abandoned (see `abandonHalfMadeOrder`) so Book again creates a
 * new one with the corrected details. Returns the abandoned order's id for the caller to cancel
 * after commit (`cancelAbandonedOrder`), else null.
 */
export async function savePickupDetails(
  client: Db,
  p: { businessId: string; returnId: string; details?: PickupDetails | null },
): Promise<{ abandonedOrderId: string | null }> {
  const resolved = await resolvePickupDetails(client, p.businessId, p.returnId, p.details);
  if (!resolved) return { abandonedOrderId: null };
  const { saved, values: v } = resolved;
  const savedNum = (k: string) => (saved[k] == null || saved[k] === '' ? null : Number(saved[k]));

  await client.query(
    `UPDATE order_returns
        SET pickup_address = $3, pickup_pincode = $4, pickup_phone = $5, pickup_weight_kg = $6,
            pickup_length_cm = $7, pickup_breadth_cm = $8, pickup_height_cm = $9, updated_at = NOW()
      WHERE id = $1 AND business_id = $2`,
    [p.returnId, p.businessId, v.address, v.pincode, v.phone, v.weightKg, v.lengthCm, v.breadthCm, v.heightCm],
  );

  const halfMade = Boolean(saved.carrier_order_id) && !saved.awb;
  const changed =
    (saved.pickup_address ?? null) !== v.address ||
    (saved.pickup_pincode ?? null) !== v.pincode ||
    (saved.pickup_phone ?? null) !== v.phone ||
    savedNum('pickup_weight_kg') !== v.weightKg ||
    savedNum('pickup_length_cm') !== v.lengthCm ||
    savedNum('pickup_breadth_cm') !== v.breadthCm ||
    savedNum('pickup_height_cm') !== v.heightCm;
  if (!halfMade || !changed) return { abandonedOrderId: null };
  return { abandonedOrderId: await abandonHalfMadeOrder(client, p.businessId, p.returnId) };
}

export type ReturnPickupResult =
  | {
      ok: true;
      awb: string;
      courierName: string;
      trackingUrl: string;
      pickupScheduledAt: string | null;
      /** Booked, but pickup could not be requested; the shop can request it in Shiprocket. */
      warning?: string;
    }
  | {
      ok: false;
      code: 'NOT_CONFIGURED' | 'NOT_FOUND' | 'NOT_APPROVED' | 'NO_ADDRESS' | 'NO_PINCODE' | 'NO_PHONE' | 'BOOKING_FAILED';
      error: string;
    };

interface PickupRow {
  id: string;
  return_number: string;
  status: string;
  return_method: string | null;
  reason: ReturnReason;
  invoice_id: string;
  fulfilment_id: string | null;
  store_order_id: string | null;
  sales_order_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  pickup_address: string | null;
  pickup_pincode: string | null;
  pickup_phone: string | null;
  pickup_weight_kg: string | null;
  pickup_length_cm: string | null;
  pickup_breadth_cm: string | null;
  pickup_height_cm: string | null;
  pickup_status: PickupStatus | null;
  pickup_attempt: number;
  carrier_order_id: string | null;
  carrier_shipment_id: string | null;
  awb: string | null;
  courier_name: string | null;
  tracking_url: string | null;
  pickup_scheduled_at: string | null;
}

async function loadPickupRow(businessId: string, returnId: string): Promise<PickupRow | null> {
  const r = await getPool().query<PickupRow>(
    `SELECT r.id, r.return_number, r.status, r.return_method, r.reason, r.invoice_id, r.fulfilment_id,
            r.store_order_id, r.sales_order_id, r.customer_id,
            c.name AS customer_name, COALESCE(NULLIF(so.customer_email, ''), c.email) AS customer_email,
            r.pickup_address, r.pickup_pincode, r.pickup_phone,
            r.pickup_weight_kg::text, r.pickup_length_cm::text, r.pickup_breadth_cm::text, r.pickup_height_cm::text,
            r.pickup_status, r.pickup_attempt, r.carrier_order_id, r.carrier_shipment_id, r.awb, r.courier_name,
            r.tracking_url, r.pickup_scheduled_at
       FROM order_returns r
       LEFT JOIN customers c ON c.id = r.customer_id AND c.business_id = r.business_id
       LEFT JOIN store_orders so ON so.id = r.store_order_id AND so.business_id = r.business_id
      WHERE r.id = $1 AND r.business_id = $2`,
    [returnId, businessId],
  );
  return r.rows[0] ?? null;
}

export const PICKUP_BUSY = 'A pickup is already being booked for this return. Try again in a moment.';

/**
 * Runs `fn` while holding this return's pickup lock: a Postgres session-level advisory lock on a
 * pooled connection of its own, held through the slow Shiprocket round trip (no transaction stays
 * open meanwhile). Booking, cancelling the pickup, rejecting, cancelling and changing the way back
 * all take it, so none of them can overlap a booking in flight. `{ busy: true }` when another
 * request holds it; callers answer with PICKUP_BUSY. Not re-entrant across calls: code already
 * holding it passes `lockHeld` to bookReturnPickup / cancelReturnPickup.
 */
export async function withReturnPickupLock<T>(
  returnId: string,
  fn: () => Promise<T>,
): Promise<{ busy: false; value: T } | { busy: true }> {
  const key = `return-pickup:${returnId}`;
  const c = await getPool().connect();
  let locked = false;
  let broken: Error | undefined;
  try {
    const r = await c.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [key]);
    locked = r.rows[0]?.locked === true;
    if (!locked) return { busy: true };
    return { busy: false, value: await fn() };
  } finally {
    if (locked) {
      try {
        await c.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key]);
      } catch (e) {
        // Never hand a connection that may still hold the lock back to the pool: drop it instead.
        broken = e instanceof Error ? e : new Error(String(e));
      }
    }
    c.release(broken);
  }
}

async function shiprocketClientFor(businessId: string): Promise<ShiprocketClient | null> {
  const creds = await loadShiprocketCreds(businessId);
  return creds ? createShiprocketClient(creds) : null;
}

/** Shiprocket sends local Indian time as "YYYY-MM-DD HH:MM:SS"; anything else is dropped. */
function istTimestamp(v: string | null | undefined): string | null {
  const m = (v ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?/);
  return m ? `${m[1]}T${m[2]}${m[3] ?? ':00'}+05:30` : null;
}

async function saveBookingError(businessId: string, returnId: string, error: string): Promise<void> {
  await getPool().query(
    `UPDATE order_returns SET pickup_error = $3, updated_at = NOW() WHERE id = $1 AND business_id = $2`,
    [returnId, businessId, error.slice(0, 500)],
  );
}

/** What Shiprocket needs for this return, or the reason it cannot be booked yet. */
async function buildReturnParcel(
  businessId: string,
  row: PickupRow,
): Promise<
  | { ok: true; parcel: ShiprocketReturnParcel }
  | { ok: false; code: 'NO_ADDRESS' | 'NO_PINCODE' | 'NO_PHONE'; error: string }
> {
  let address = clean(row.pickup_address, 500);
  let pincode = (row.pickup_pincode ?? '').replace(/\D/g, '');
  let phone = row.pickup_phone ?? '';
  if (!address || pincode.length !== 6 || !phone) {
    // Returns that skipped approval (or were approved before the details were saved).
    const d = await orderDefaults(getPool(), businessId, row.id, row);
    address = address ?? d.address;
    pincode = pincode.length === 6 ? pincode : (d.pincode ?? '');
    phone = phone || (d.phone ?? '');
  }
  if (!address) return { ok: false, code: 'NO_ADDRESS', error: "Add the customer's pickup address before booking a courier" };
  if (pincode.length !== 6) return { ok: false, code: 'NO_PINCODE', error: 'Add a 6-digit PIN code before booking a courier' };
  const tenDigits = tenDigitPhone(phone);
  if (!tenDigits) return { ok: false, code: 'NO_PHONE', error: "The customer's 10-digit phone number is needed for the courier" };

  const lines = await getPool().query<{
    item_name: string;
    quantity: string;
    unit_price: string;
    tax_rate: string;
    code: string | null;
  }>(
    `SELECT ri.item_name, ri.quantity::text, ri.unit_price::text, ri.tax_rate::text, it.code
       FROM order_return_items ri
       LEFT JOIN items it ON it.id = ri.item_id AND it.business_id = $2
      WHERE ri.return_id = $1
      ORDER BY ri.sort_order, ri.id`,
    [row.id, businessId],
  );
  const reason = RETURN_REASON_LABELS[row.reason] ?? row.reason;
  const items: ShiprocketReturnParcel['items'] = lines.rows.map((l, i) => {
    const qty = Number(l.quantity) || 0;
    const units = Math.max(1, Math.round(qty));
    // Per-unit price with GST, to the paisa; a part unit (2.5 kg) is spread over the whole units.
    const perSoldUnit = (Number(l.unit_price) || 0) * (1 + (Number(l.tax_rate) || 0) / 100);
    return {
      name: l.item_name || 'Item',
      sku: (l.code ?? '').trim() || `${row.return_number}-${i + 1}`,
      units,
      price: Math.round(((perSoldUnit * (qty || 1)) / units) * 100) / 100,
      reason,
    };
  });
  const subTotal = Math.round(items.reduce((s, i) => s + i.price * i.units, 0) * 100) / 100;

  return {
    ok: true,
    parcel: {
      ref: row.pickup_attempt > 0 ? `${row.return_number}-${row.pickup_attempt + 1}` : row.return_number,
      customerName: row.customer_name || 'Customer',
      customerPhone: tenDigits,
      customerEmail: row.customer_email,
      address,
      pincode,
      items,
      subTotal,
      weightKg: Number(row.pickup_weight_kg) || DEFAULT_RETURN_WEIGHT_KG,
      lengthCm: Number(row.pickup_length_cm) || undefined,
      breadthCm: Number(row.pickup_breadth_cm) || undefined,
      heightCm: Number(row.pickup_height_cm) || undefined,
    },
  };
}

/**
 * Books the courier pickup of an approved return: Shiprocket return order, courier + AWB, pickup.
 * Saves Shiprocket's ids even on a partial failure so "Book again" continues instead of creating a
 * duplicate order. A failure leaves the return approved with the reason in `pickup_error`.
 * Runs on its own connection, outside any request transaction (the Shiprocket calls are slow),
 * holding the return's pickup lock (`withReturnPickupLock`) so a second click, the phone app or a
 * reject cannot start while Shiprocket is still answering.
 */
export async function bookReturnPickup(
  businessId: string,
  returnId: string,
  opts: {
    client?: ShiprocketClient;
    actorUserId?: string | null;
    /** An order the shop's last change gave up on (`abandonedOrderId` from approve / setReturnMethod): cancelled first, best effort. */
    abandonedOrderId?: string | null;
    /** The caller already holds the pickup lock for this return. */
    lockHeld?: boolean;
  } = {},
): Promise<ReturnPickupResult> {
  if (opts.lockHeld) return bookLocked(businessId, returnId, opts);
  const out = await withReturnPickupLock(returnId, () => bookLocked(businessId, returnId, opts));
  return out.busy ? { ok: false, code: 'BOOKING_FAILED', error: PICKUP_BUSY } : out.value;
}

async function bookLocked(
  businessId: string,
  returnId: string,
  opts: { client?: ShiprocketClient; actorUserId?: string | null; abandonedOrderId?: string | null },
): Promise<ReturnPickupResult> {
  const row = await loadPickupRow(businessId, returnId);
  if (!row) return { ok: false, code: 'NOT_FOUND', error: 'Return not found' };
  if (row.status !== 'approved' || row.return_method !== 'courier_pickup') {
    return { ok: false, code: 'NOT_APPROVED', error: 'Approve the return with a courier pickup before booking it' };
  }
  if (row.pickup_status === 'in_transit' || row.pickup_status === 'arrived') {
    // Booking again now would hand the parcel a second AWB and reset its status.
    return { ok: false, code: 'NOT_APPROVED', error: 'The parcel is already on its way back; receive it instead' };
  }
  if (hasLivePickup(row) && row.awb) {
    return {
      ok: true,
      awb: row.awb,
      courierName: row.courier_name ?? 'Shiprocket',
      trackingUrl: row.tracking_url ?? shiprocketTrackingUrl(row.awb),
      pickupScheduledAt: row.pickup_scheduled_at,
    };
  }

  const fail = async <T extends Extract<ReturnPickupResult, { ok: false }>>(f: T): Promise<T> => {
    await saveBookingError(businessId, returnId, f.error);
    return f;
  };

  const client = opts.client ?? (await shiprocketClientFor(businessId));
  if (!client) return fail({ ok: false, code: 'NOT_CONFIGURED', error: NOT_CONNECTED });
  const built = await buildReturnParcel(businessId, row);
  if (!built.ok) return fail(built);

  // The earlier order had the old details; free its Shiprocket reference before making the new one.
  let cancelNote: string | null = null;
  if (opts.abandonedOrderId) {
    const cancelled = await cancelAbandonedOrder(businessId, opts.abandonedOrderId, { client });
    if (!cancelled.ok) {
      cancelNote = `The earlier Shiprocket order ${opts.abandonedOrderId} could not be cancelled: ${cancelled.error}`;
    }
  }

  const booked = await client.bookReturn(built.parcel, {
    orderId: row.carrier_order_id,
    shipmentId: row.carrier_shipment_id,
  });
  const gotAwb = booked.ok && Boolean(booked.awb);

  let applied = false;
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    // Only while the return still wants this pickup (it may have been received meanwhile).
    const updated = await c.query(
      `UPDATE order_returns
          SET carrier_order_id = COALESCE($3, carrier_order_id),
              carrier_shipment_id = COALESCE($4, carrier_shipment_id),
              awb = COALESCE($5, awb),
              courier_name = COALESCE($6, courier_name),
              tracking_url = COALESCE($7, tracking_url),
              pickup_scheduled_at = COALESCE($8::timestamptz, pickup_scheduled_at),
              pickup_status = CASE WHEN $5::text IS NOT NULL THEN 'booked' ELSE pickup_status END,
              pickup_error = $9,
              updated_at = NOW()
        WHERE id = $1 AND business_id = $2 AND status = 'approved' AND return_method = 'courier_pickup'`,
      [
        row.id,
        businessId,
        booked.orderId ?? null,
        booked.shipmentId ?? null,
        gotAwb ? booked.awb : null,
        gotAwb ? (booked.courierName ?? 'Shiprocket') : null,
        gotAwb ? (booked.trackingUrl ?? shiprocketTrackingUrl(booked.awb as string)) : null,
        istTimestamp(booked.pickupScheduledAt),
        [booked.error, cancelNote].filter(Boolean).join(' · ').slice(0, 500) || null,
      ],
    );
    applied = (updated.rowCount ?? 0) > 0;
    if (applied && gotAwb) {
      await recordReturnEvent(c, {
        businessId,
        returnId: row.id,
        kind: 'pickup_booked',
        note: `Booked with ${booked.courierName ?? 'Shiprocket'} · AWB ${booked.awb}`.slice(0, 500),
        actorType: 'staff',
        actorUserId: opts.actorUserId ?? null,
      });
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }

  if (!applied) {
    // The return was rejected, received or switched while Shiprocket answered: the order must not stay.
    if (booked.orderId) {
      await cancelAbandonedOrder(businessId, booked.orderId, { client });
      return { ok: false, code: 'BOOKING_FAILED', error: 'The return changed while the pickup was being booked; the pickup was cancelled.' };
    }
    return { ok: false, code: 'BOOKING_FAILED', error: 'The return changed while the pickup was being booked.' };
  }
  if (!gotAwb) {
    return { ok: false, code: 'BOOKING_FAILED', error: booked.error || 'Shiprocket booking failed' };
  }
  return {
    ok: true,
    awb: booked.awb as string,
    courierName: booked.courierName ?? 'Shiprocket',
    trackingUrl: booked.trackingUrl ?? shiprocketTrackingUrl(booked.awb as string),
    pickupScheduledAt: booked.pickupScheduledAt ?? null,
    ...(booked.error ? { warning: `Booked, but pickup was not requested: ${booked.error}` } : cancelNote ? { warning: cancelNote } : {}),
  };
}

/**
 * Cancels a pickup that has not left yet. The next booking gets a new Shiprocket reference
 * (`pickup_attempt` goes up by one) so Shiprocket never sees the same order id twice.
 * Holds the pickup lock unless the caller already does (`lockHeld`); busy = 409 PICKUP_BUSY.
 */
export async function cancelReturnPickup(
  businessId: string,
  returnId: string,
  opts: { client?: ShiprocketClient; actorUserId?: string | null; lockHeld?: boolean } = {},
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (opts.lockHeld) return cancelLocked(businessId, returnId, opts);
  const out = await withReturnPickupLock(returnId, () => cancelLocked(businessId, returnId, opts));
  return out.busy ? { ok: false, status: 409, error: PICKUP_BUSY } : out.value;
}

async function cancelLocked(
  businessId: string,
  returnId: string,
  opts: { client?: ShiprocketClient; actorUserId?: string | null },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const row = await loadPickupRow(businessId, returnId);
  if (!row) return { ok: false, status: 404, error: 'Return not found' };
  if (row.pickup_status === 'in_transit' || row.pickup_status === 'arrived') {
    return { ok: false, status: 409, error: 'The parcel is already on its way back; it can no longer be cancelled' };
  }
  if (!hasLivePickup(row)) return { ok: false, status: 409, error: 'There is no courier pickup to cancel on this return' };

  const client = opts.client ?? (await shiprocketClientFor(businessId));
  if (!client) return { ok: false, status: 409, error: 'Shiprocket is not connected' };
  try {
    await client.cancelOrders([row.carrier_order_id as string]);
  } catch (e) {
    return { ok: false, status: 502, error: e instanceof Error ? e.message : 'Shiprocket could not cancel the pickup' };
  }

  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `UPDATE order_returns
          SET pickup_status = 'cancelled', pickup_attempt = pickup_attempt + 1,
              carrier_order_id = NULL, carrier_shipment_id = NULL, awb = NULL, courier_name = NULL,
              tracking_url = NULL, pickup_scheduled_at = NULL, pickup_error = NULL, updated_at = NOW()
        WHERE id = $1 AND business_id = $2`,
      [row.id, businessId],
    );
    await recordReturnEvent(c, {
      businessId,
      returnId: row.id,
      kind: 'pickup_cancelled',
      note: row.awb ? `Pickup cancelled · AWB ${row.awb}` : 'Pickup cancelled',
      actorType: 'staff',
      actorUserId: opts.actorUserId ?? null,
    });
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
 * A Shiprocket tracking event for a return parcel (spec section 5). Matches this business's return by
 * AWB, else by Shiprocket's order id (events can arrive before the AWB is saved), row-locked so two
 * deliveries of one event cannot both apply. Statuses only move forward; an out-of-order or unknown
 * label is `unchanged`. `not_found` means the event is not for any return of this business.
 *
 * A cancel from Shiprocket (a failed quality check, say) clears the ids the way `cancelReturnPickup`
 * does, without calling Shiprocket, so Book again makes a new order with the next reference.
 */
export async function applyShiprocketReturnUpdate(input: {
  businessId: string;
  awb: string;
  srOrderId: string;
  label: string;
  qcFailureReason: string | null;
}): Promise<{ outcome: 'not_found' | 'unchanged' | 'updated'; returnId?: string; to?: PickupStatus }> {
  const awb = input.awb.trim();
  const srOrderId = input.srOrderId.trim();
  if (!awb && !srOrderId) return { outcome: 'not_found' };

  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    const find = async (column: 'awb' | 'carrier_order_id', value: string) =>
      value
        ? (
            await c.query<{ id: string; pickup_status: PickupStatus | null; awb: string | null }>(
              `SELECT id, pickup_status, awb FROM order_returns WHERE business_id = $1 AND ${column} = $2 FOR UPDATE`,
              [input.businessId, value],
            )
          ).rows[0]
        : undefined;
    const row = (await find('awb', awb)) ?? (await find('carrier_order_id', srOrderId));
    if (!row) {
      await c.query('ROLLBACK');
      return { outcome: 'not_found' };
    }

    const to = parseShiprocketReturnStatus(input.label);
    if (!to || !canMovePickupStatus(row.pickup_status, to)) {
      await c.query('ROLLBACK');
      return { outcome: 'unchanged', returnId: row.id };
    }

    // The reason the pickup stopped: Shiprocket's own, else the status it sent. Moving on clears it.
    const stopped = to === 'pickup_issue' || to === 'cancelled';
    const error = stopped ? (input.qcFailureReason ?? input.label).slice(0, 500) : null;
    await c.query(
      `UPDATE order_returns
          SET pickup_status = $3::text,
              picked_up_at = CASE WHEN $3::text = 'in_transit' THEN COALESCE(picked_up_at, NOW()) ELSE picked_up_at END,
              arrived_at = CASE WHEN $3::text = 'arrived' THEN COALESCE(arrived_at, NOW()) ELSE arrived_at END,
              pickup_error = $4,
              pickup_attempt = CASE WHEN $3::text = 'cancelled' THEN pickup_attempt + 1 ELSE pickup_attempt END,
              carrier_order_id = CASE WHEN $3::text = 'cancelled' THEN NULL ELSE carrier_order_id END,
              carrier_shipment_id = CASE WHEN $3::text = 'cancelled' THEN NULL ELSE carrier_shipment_id END,
              awb = CASE WHEN $3::text = 'cancelled' THEN NULL ELSE awb END,
              courier_name = CASE WHEN $3::text = 'cancelled' THEN NULL ELSE courier_name END,
              tracking_url = CASE WHEN $3::text = 'cancelled' THEN NULL ELSE tracking_url END,
              pickup_scheduled_at = CASE WHEN $3::text = 'cancelled' THEN NULL ELSE pickup_scheduled_at END,
              updated_at = NOW()
        WHERE id = $1 AND business_id = $2`,
      [row.id, input.businessId, to, error],
    );
    await recordReturnEvent(c, {
      businessId: input.businessId,
      returnId: row.id,
      kind: 'pickup_status',
      note: input.label.slice(0, 500) || null,
      actorType: 'webhook',
    });
    await c.query('COMMIT');
    // Only the update that moved it to arrived tells the shop; a repeated event stops above as unchanged.
    if (to === 'arrived') await notifyMerchantReturn(input.businessId, row.id, 'arrived');
    return { outcome: 'updated', returnId: row.id, to };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
