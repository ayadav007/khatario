import { randomBytes, randomInt } from 'crypto';
import type { PoolClient } from 'pg';
import type { InvoiceChannel } from '@/lib/invoices/channel';
import { resolveTrackingUrl, safeHttpUrl } from './couriers';
import {
  canDispatch,
  canTransitionFulfilment,
  requiresPaymentFor,
  storeDispatchToMethod,
  storeStatusToFulfilment,
  type FulfilmentMethod,
  type FulfilmentStatus,
} from './rules';

export type FulfilmentActor = 'staff' | 'webhook' | 'system' | 'bot';

export interface FulfilmentRow {
  id: string;
  business_id: string;
  branch_id: string | null;
  channel: InvoiceChannel;
  store_order_id: string | null;
  sales_order_id: string | null;
  invoice_id: string | null;
  customer_id: string | null;
  seq: number;
  buyer_name: string | null;
  buyer_phone: string | null;
  status: FulfilmentStatus;
  method: FulfilmentMethod | null;
  partner_name: string | null;
  awb: string | null;
  tracking_url: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_code: string | null;
  proof_photo_url: string | null;
  cod_amount: string;
  cod_collected_at: string | null;
  failure_reason: string | null;
  public_token: string;
  notified_statuses: string[];
  ship_address?: string | null;
  ship_pincode?: string | null;
  packages?: number;
  carrier_order_id?: string | null;
  carrier_shipment_id?: string | null;
  weight_kg?: string | null;
  label_url?: string | null;
  manifest_url?: string | null;
  pickup_scheduled_at?: string | null;
  booking_error?: string | null;
  status_changed_at: string;
}

export interface FulfilmentShipping {
  address?: string | null;
  pincode?: string | null;
  packages?: number | null;
  weightKg?: number | null;
}

/** Parcel weight in kg, 10 g to 500 kg, rounded to grams; null when unusable. */
export function cleanWeightKg(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0.01) return null;
  return Math.round(Math.min(500, n) * 1000) / 1000;
}

/** Saves the delivery address, box count and weight used for labels and courier booking. */
export async function setFulfilmentShipping(
  client: PoolClient,
  input: { businessId: string; fulfilmentId: string } & FulfilmentShipping,
): Promise<boolean> {
  const pin = input.pincode != null ? String(input.pincode).replace(/\D/g, '').slice(0, 6) || null : undefined;
  const packages =
    input.packages != null ? Math.min(50, Math.max(1, Math.round(Number(input.packages) || 1))) : undefined;
  const weight = input.weightKg != null ? cleanWeightKg(input.weightKg) : null;
  const res = await client.query(
    `UPDATE order_fulfilments
        SET ship_address = CASE WHEN $3::boolean THEN $4::text ELSE ship_address END,
            ship_pincode = CASE WHEN $5::boolean THEN $6::varchar ELSE ship_pincode END,
            packages = COALESCE($7::smallint, packages),
            weight_kg = COALESCE($8::numeric, weight_kg),
            updated_at = NOW()
      WHERE id = $1 AND business_id = $2`,
    [
      input.fulfilmentId,
      input.businessId,
      input.address !== undefined,
      clip(input.address, 500),
      pin !== undefined,
      pin ?? null,
      packages ?? null,
      weight,
    ],
  );
  return res.rowCount === 1;
}

export interface FulfilmentDetails {
  method?: FulfilmentMethod | null;
  partnerName?: string | null;
  awb?: string | null;
  trackingUrl?: string | null;
  riderName?: string | null;
  riderPhone?: string | null;
  proofPhotoUrl?: string | null;
  failureReason?: string | null;
  codAmount?: number | null;
}

export interface EnsureFulfilmentInput {
  businessId: string;
  channel: InvoiceChannel;
  storeOrderId?: string | null;
  salesOrderId?: string | null;
  invoiceId?: string | null;
  branchId?: string | null;
  customerId?: string | null;
  buyerName?: string | null;
  buyerPhone?: string | null;
  status?: FulfilmentStatus;
  method?: FulfilmentMethod | null;
  codAmount?: number;
  actorType?: FulfilmentActor;
  actorUserId?: string | null;
  note?: string | null;
}

export type FulfilmentTransitionResult =
  | { ok: true; changed: boolean; fulfilmentId: string; from: FulfilmentStatus; to: FulfilmentStatus }
  | {
      ok: false;
      status: 404 | 409 | 422;
      code: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'PAYMENT_REQUIRED' | 'PICKUP_CODE_MISMATCH';
      error: string;
      from?: FulfilmentStatus;
    };

export function newPublicToken(): string {
  return randomBytes(18).toString('base64url');
}

export function newPickupCode(): string {
  return String(randomInt(1000, 10000));
}

function clip(v: string | null | undefined, max: number): string | null {
  const s = (v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

async function recordEvent(
  client: PoolClient,
  row: { id: string; business_id: string },
  status: FulfilmentStatus,
  actorType: FulfilmentActor,
  actorUserId: string | null | undefined,
  note: string | null | undefined,
): Promise<void> {
  await client.query(
    `INSERT INTO order_fulfilment_events (fulfilment_id, business_id, status, note, actor_type, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.id, row.business_id, status, clip(note, 500), actorType, actorUserId ?? null],
  );
}

/**
 * Returns the first fulfilment of an order, creating it when missing. Keyed on the order's source
 * (store order, else sales order, else invoice) so a retry never makes a second row.
 */
export async function ensureFulfilment(
  client: PoolClient,
  input: EnsureFulfilmentInput,
): Promise<{ row: FulfilmentRow; created: boolean }> {
  const storeOrderId = input.storeOrderId ?? null;
  const salesOrderId = storeOrderId ? null : input.salesOrderId ?? null;
  const invoiceId = input.invoiceId ?? null;
  if (!storeOrderId && !salesOrderId && !invoiceId) {
    throw new Error('ensureFulfilment needs a store order, sales order or invoice');
  }

  const [keyCol, keyVal, conflict] = storeOrderId
    ? ['store_order_id', storeOrderId, '(store_order_id, seq) WHERE store_order_id IS NOT NULL']
    : salesOrderId
      ? ['sales_order_id', salesOrderId, '(sales_order_id, seq) WHERE sales_order_id IS NOT NULL AND store_order_id IS NULL']
      : [
          'invoice_id',
          invoiceId,
          '(invoice_id, seq) WHERE invoice_id IS NOT NULL AND store_order_id IS NULL AND sales_order_id IS NULL',
        ];

  const status = input.status ?? 'new';
  const inserted = await client.query<FulfilmentRow>(
    `INSERT INTO order_fulfilments (
       business_id, branch_id, channel, store_order_id, sales_order_id, invoice_id, customer_id,
       buyer_name, buyer_phone, status, method, cod_amount, public_token, pickup_code,
       delivered_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::varchar, $11, $12, $13, $14,
               CASE WHEN $10::varchar = 'delivered' THEN NOW() END)
     ON CONFLICT ${conflict} DO NOTHING
     RETURNING *`,
    [
      input.businessId,
      input.branchId ?? null,
      input.channel,
      storeOrderId,
      salesOrderId,
      invoiceId,
      input.customerId ?? null,
      clip(input.buyerName, 255),
      clip(input.buyerPhone, 20),
      status,
      input.method ?? null,
      Math.max(0, Number(input.codAmount) || 0),
      newPublicToken(),
      input.method === 'pickup' ? newPickupCode() : null,
    ],
  );
  if (inserted.rows[0]) {
    await recordEvent(client, inserted.rows[0], status, input.actorType ?? 'system', input.actorUserId, input.note);
    return { row: inserted.rows[0], created: true };
  }

  const existing = await client.query<FulfilmentRow>(
    `SELECT * FROM order_fulfilments WHERE business_id = $1 AND ${keyCol} = $2 ORDER BY seq LIMIT 1`,
    [input.businessId, keyVal],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('Fulfilment belongs to another business');
  // A later step (invoice created after payment) fills links the first insert did not have.
  if ((invoiceId && !row.invoice_id) || (input.customerId && !row.customer_id)) {
    const upd = await client.query<FulfilmentRow>(
      `UPDATE order_fulfilments
          SET invoice_id = COALESCE(invoice_id, $3), customer_id = COALESCE(customer_id, $4), updated_at = NOW()
        WHERE id = $1 AND business_id = $2
        RETURNING *`,
      [row.id, input.businessId, invoiceId, input.customerId ?? null],
    );
    return { row: upd.rows[0], created: false };
  }
  return { row, created: false };
}

/** Paid in full on the order, its invoice, or (store orders) agreed cash on delivery. */
export async function fulfilmentPaymentState(
  client: PoolClient,
  row: Pick<FulfilmentRow, 'business_id' | 'store_order_id' | 'sales_order_id' | 'invoice_id' | 'cod_amount'>,
): Promise<{ paid: boolean; codAmount: number }> {
  const res = await client.query<{ paid: boolean; cod: boolean }>(
    `SELECT
       COALESCE(so.payment_status = 'paid', FALSE)
         OR COALESCE(s.payment_status = 'paid', FALSE)
         OR COALESCE(i.payment_status = 'paid', FALSE) AS paid,
       COALESCE(so.payment_status = 'cod', FALSE) AS cod
     FROM (SELECT 1) one
     LEFT JOIN store_orders so ON so.id = $2 AND so.business_id = $1
     LEFT JOIN sales_orders s ON s.id = $3 AND s.business_id = $1
     LEFT JOIN invoices i ON i.id = $4 AND i.business_id = $1`,
    [row.business_id, row.store_order_id, row.sales_order_id, row.invoice_id],
  );
  const r = res.rows[0];
  const cod = Number(row.cod_amount) || 0;
  return { paid: Boolean(r?.paid), codAmount: cod > 0 ? cod : r?.cod ? 1 : 0 };
}

export interface TransitionFulfilmentInput {
  businessId: string;
  fulfilmentId: string;
  to: FulfilmentStatus;
  actorType: FulfilmentActor;
  actorUserId?: string | null;
  note?: string | null;
  details?: FulfilmentDetails;
  /** Staff handover of a pickup order must quote the buyer's code. */
  pickupCode?: string | null;
  requirePickupCode?: boolean;
  /** The caller already checked payment (store lifecycle). */
  skipPaymentGate?: boolean;
}

/** Locks the fulfilment, validates the move, applies details and writes a timeline event. */
export async function transitionFulfilment(
  client: PoolClient,
  input: TransitionFulfilmentInput,
): Promise<FulfilmentTransitionResult> {
  const found = await client.query<FulfilmentRow>(
    `SELECT * FROM order_fulfilments WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [input.fulfilmentId, input.businessId],
  );
  const row = found.rows[0];
  if (!row) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'Delivery record not found' };

  const from = row.status;
  const changed = from !== input.to;
  if (changed && !canTransitionFulfilment(from, input.to)) {
    return {
      ok: false,
      status: 409,
      code: 'INVALID_TRANSITION',
      error: `Cannot change a ${from.replace(/_/g, ' ')} order to ${input.to.replace(/_/g, ' ')}`,
      from,
    };
  }

  const d = input.details ?? {};
  const codAmount = d.codAmount != null ? Math.max(0, Number(d.codAmount) || 0) : Number(row.cod_amount) || 0;
  if (changed && requiresPaymentFor(input.to) && !input.skipPaymentGate) {
    const pay = await fulfilmentPaymentState(client, { ...row, cod_amount: String(codAmount) });
    if (!canDispatch(pay)) {
      return {
        ok: false,
        status: 409,
        code: 'PAYMENT_REQUIRED',
        error: 'Cannot dispatch until the order is paid or marked cash on delivery',
        from,
      };
    }
  }

  const method = d.method !== undefined ? d.method : row.method;
  if (
    changed &&
    input.to === 'delivered' &&
    input.requirePickupCode &&
    method === 'pickup' &&
    row.pickup_code &&
    (input.pickupCode ?? '').trim() !== row.pickup_code
  ) {
    return { ok: false, status: 422, code: 'PICKUP_CODE_MISMATCH', error: 'Pickup code does not match', from };
  }

  const partnerName = d.partnerName !== undefined ? clip(d.partnerName, 100) : row.partner_name;
  const awb = d.awb !== undefined ? clip(d.awb, 100) : row.awb;
  const trackingUrl =
    d.trackingUrl !== undefined || d.awb !== undefined || d.partnerName !== undefined
      ? resolveTrackingUrl({ partnerName, awb, pastedUrl: d.trackingUrl ?? null }) ??
        (d.trackingUrl === undefined ? row.tracking_url : null)
      : row.tracking_url;
  const pickupCode =
    row.pickup_code ?? (method === 'pickup' && (input.to === 'ready_for_pickup' || input.to === 'packed') ? newPickupCode() : null);

  await client.query(
    `UPDATE order_fulfilments
        SET status = $3::varchar,
            method = $4,
            partner_name = $5,
            awb = $6,
            tracking_url = $7,
            rider_name = $8,
            rider_phone = $9,
            proof_photo_url = $10,
            failure_reason = CASE WHEN $3::varchar = 'delivery_failed' THEN $11::text ELSE failure_reason END,
            cod_amount = $12,
            pickup_code = $13,
            status_changed_at = CASE WHEN $14::boolean THEN NOW() ELSE status_changed_at END,
            shipped_at = CASE WHEN $3::varchar = 'shipped' AND shipped_at IS NULL THEN NOW() ELSE shipped_at END,
            delivered_at = CASE WHEN $3::varchar = 'delivered' THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
            updated_at = NOW()
      WHERE id = $1 AND business_id = $2`,
    [
      row.id,
      input.businessId,
      input.to,
      method,
      partnerName,
      awb,
      trackingUrl,
      d.riderName !== undefined ? clip(d.riderName, 100) : row.rider_name,
      d.riderPhone !== undefined ? clip(d.riderPhone, 20) : row.rider_phone,
      d.proofPhotoUrl !== undefined ? safeHttpUrl(d.proofPhotoUrl) : row.proof_photo_url,
      clip(d.failureReason, 500),
      codAmount,
      pickupCode,
      changed,
    ],
  );

  if (changed) {
    await recordEvent(client, row, input.to, input.actorType, input.actorUserId, input.note ?? d.failureReason);
  }
  return { ok: true, changed, fulfilmentId: row.id, from, to: input.to };
}

const SAME_ORDER = `x.business_id = f.business_id
                AND x.store_order_id IS NOT DISTINCT FROM f.store_order_id
                AND x.sales_order_id IS NOT DISTINCT FROM f.sales_order_id
                AND x.invoice_id IS NOT DISTINCT FROM f.invoice_id`;

export type AddShipmentResult =
  | { ok: true; row: FulfilmentRow }
  | { ok: false; code: 'NOT_FOUND' | 'PARCEL_PENDING'; error: string; pendingSeq?: number };

/**
 * Another parcel for an order going out in parts; copies links and buyer from the first. Refused
 * while any parcel of the order is still waiting to go out, so repeated clicks cannot pile up
 * empty parcels.
 */
export async function addShipment(
  client: PoolClient,
  input: { businessId: string; fulfilmentId: string; actorUserId?: string | null },
): Promise<AddShipmentResult> {
  const pending = await client.query<{ seq: number }>(
    `SELECT x.seq
       FROM order_fulfilments f
       JOIN order_fulfilments x ON ${SAME_ORDER}
      WHERE f.id = $1 AND f.business_id = $2
        AND x.status IN ('new', 'confirmed', 'packed')
      ORDER BY x.seq
      LIMIT 1`,
    [input.fulfilmentId, input.businessId],
  );
  if (pending.rows[0]) {
    const seq = pending.rows[0].seq;
    return {
      ok: false,
      code: 'PARCEL_PENDING',
      pendingSeq: seq,
      error: `Parcel ${seq} has not gone out yet. Dispatch it first, or remove it if it is not needed.`,
    };
  }
  const res = await client.query<FulfilmentRow>(
    `INSERT INTO order_fulfilments (
       business_id, branch_id, channel, store_order_id, sales_order_id, invoice_id, customer_id, seq,
       buyer_name, buyer_phone, status, public_token
     )
     SELECT f.business_id, f.branch_id, f.channel, f.store_order_id, f.sales_order_id, f.invoice_id, f.customer_id,
            (SELECT MAX(x.seq) + 1 FROM order_fulfilments x WHERE ${SAME_ORDER}),
            f.buyer_name, f.buyer_phone, 'confirmed', $3
       FROM order_fulfilments f
      WHERE f.id = $1 AND f.business_id = $2
     RETURNING *`,
    [input.fulfilmentId, input.businessId, newPublicToken()],
  );
  const row = res.rows[0];
  if (!row) return { ok: false, code: 'NOT_FOUND', error: 'Delivery record not found' };
  await recordEvent(client, row, 'confirmed', 'staff', input.actorUserId, `Parcel ${row.seq}`);
  return { ok: true, row };
}

/** Deletes an extra parcel (not the first) that has not been dispatched or booked with a courier. */
export async function removeShipment(
  client: PoolClient,
  input: { businessId: string; fulfilmentId: string },
): Promise<boolean> {
  const res = await client.query(
    `DELETE FROM order_fulfilments
      WHERE id = $1 AND business_id = $2 AND seq > 1
        AND status IN ('new', 'confirmed', 'packed')
        AND awb IS NULL AND carrier_shipment_id IS NULL`,
    [input.fulfilmentId, input.businessId],
  );
  return res.rowCount === 1;
}

/** Marks cash on delivery as collected (once). */
export async function markCodCollected(
  client: PoolClient,
  input: { businessId: string; fulfilmentId: string; actorUserId?: string | null },
): Promise<{ ok: boolean; alreadyCollected?: boolean }> {
  const res = await client.query<{ id: string; business_id: string; status: FulfilmentStatus }>(
    `UPDATE order_fulfilments
        SET cod_collected_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND business_id = $2 AND cod_collected_at IS NULL AND cod_amount > 0
      RETURNING id, business_id, status`,
    [input.fulfilmentId, input.businessId],
  );
  if (!res.rows[0]) {
    const exists = await client.query(
      `SELECT cod_collected_at FROM order_fulfilments WHERE id = $1 AND business_id = $2`,
      [input.fulfilmentId, input.businessId],
    );
    return { ok: exists.rows.length > 0, alreadyCollected: Boolean(exists.rows[0]?.cod_collected_at) };
  }
  await recordEvent(client, res.rows[0], res.rows[0].status, 'staff', input.actorUserId, 'Cash collected');
  return { ok: true };
}

export type FulfilmentChange = { fulfilmentId: string; to: FulfilmentStatus } | null;

/**
 * Mirrors a store order onto its fulfilment. `override` carries a finer status (out for delivery,
 * failed, returned) that the coarse store status cannot express.
 */
export async function syncStoreOrderFulfilment(
  client: PoolClient,
  input: {
    businessId: string;
    storeOrderId: string;
    actorType: FulfilmentActor;
    actorUserId?: string | null;
    override?: FulfilmentStatus | null;
    note?: string | null;
  },
): Promise<FulfilmentChange> {
  const res = await client.query<{
    status: string;
    payment_status: string;
    delivery_mode: string | null;
    dispatch_mode: string | null;
    awb: string | null;
    tracking_url: string | null;
    branch_id: string | null;
    invoice_id: string | null;
    customer_name: string;
    customer_phone: string;
    grand_total: string;
    cash_collected_at: string | null;
  }>(
    `SELECT status, payment_status, delivery_mode, dispatch_mode, awb, tracking_url, branch_id, invoice_id,
            customer_name, customer_phone, grand_total, cash_collected_at
       FROM store_orders WHERE id = $1 AND business_id = $2`,
    [input.storeOrderId, input.businessId],
  );
  const order = res.rows[0];
  if (!order) return null;

  const target =
    input.override ??
    storeStatusToFulfilment(order.status, { deliveryMode: order.delivery_mode, dispatchMode: order.dispatch_mode });
  if (!target) return null;
  const method = storeDispatchToMethod(order.delivery_mode, order.dispatch_mode);
  const codAmount = order.payment_status === 'cod' ? Number(order.grand_total) || 0 : 0;

  const { row, created } = await ensureFulfilment(client, {
    businessId: input.businessId,
    channel: 'online_store',
    storeOrderId: input.storeOrderId,
    invoiceId: order.invoice_id,
    branchId: order.branch_id,
    buyerName: order.customer_name,
    buyerPhone: order.customer_phone,
    status: target,
    method,
    codAmount,
    actorType: input.actorType,
    actorUserId: input.actorUserId,
    note: input.note,
  });
  if (created) {
    if (order.awb || order.cash_collected_at) {
      await client.query(
        `UPDATE order_fulfilments
            SET awb = COALESCE(awb, $3), tracking_url = COALESCE(tracking_url, $4),
                partner_name = COALESCE(partner_name, $5),
                cod_collected_at = CASE WHEN cod_amount > 0 THEN $6::timestamptz END
          WHERE id = $1 AND business_id = $2`,
        [
          row.id,
          input.businessId,
          order.awb,
          resolveTrackingUrl({
            partnerName: order.dispatch_mode === 'shiprocket' ? 'Shiprocket' : null,
            awb: order.awb,
            pastedUrl: order.tracking_url,
          }),
          order.dispatch_mode === 'shiprocket' ? 'Shiprocket' : null,
          order.cash_collected_at,
        ],
      );
    }
    return { fulfilmentId: row.id, to: target };
  }

  const details: FulfilmentDetails = { method, codAmount };
  if (order.awb && order.awb !== row.awb) {
    details.awb = order.awb;
    details.partnerName = row.partner_name ?? (order.dispatch_mode === 'shiprocket' ? 'Shiprocket' : null);
    details.trackingUrl = order.tracking_url;
  }
  const moved = await transitionFulfilment(client, {
    businessId: input.businessId,
    fulfilmentId: row.id,
    to: canTransitionFulfilment(row.status, target) || row.status === target ? target : row.status,
    actorType: input.actorType,
    actorUserId: input.actorUserId,
    note: input.note,
    details,
    skipPaymentGate: true,
  });
  if (order.cash_collected_at && codAmount > 0 && !row.cod_collected_at) {
    await client.query(
      `UPDATE order_fulfilments SET cod_collected_at = $3, updated_at = NOW()
        WHERE id = $1 AND business_id = $2 AND cod_collected_at IS NULL`,
      [row.id, input.businessId, order.cash_collected_at],
    );
  }
  return moved.ok && moved.changed ? { fulfilmentId: row.id, to: moved.to } : null;
}

/** Delivery record for an invoiced sales order (WhatsApp or B2B), with the buyer taken from the order. */
export async function ensureSalesOrderFulfilment(
  client: PoolClient,
  input: {
    businessId: string;
    salesOrderId: string;
    invoiceId: string | null;
    branchId?: string | null;
    actorType: FulfilmentActor;
    actorUserId?: string | null;
    note?: string | null;
  },
): Promise<{ row: FulfilmentRow; created: boolean } | null> {
  const res = await client.query<{
    customer_id: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    wa_phone: string | null;
    wa_name: string | null;
    is_whatsapp: boolean;
  }>(
    `SELECT so.customer_id, c.name AS customer_name, c.phone AS customer_phone,
            wc.conversation_id AS wa_phone, wc.whatsapp_display_name AS wa_name,
            so.whatsapp_conversation_id IS NOT NULL AS is_whatsapp
       FROM sales_orders so
       LEFT JOIN customers c ON c.id = so.customer_id AND c.business_id = so.business_id
       LEFT JOIN whatsapp_conversations wc ON wc.id = so.whatsapp_conversation_id AND wc.business_id = so.business_id
      WHERE so.id = $1 AND so.business_id = $2`,
    [input.salesOrderId, input.businessId],
  );
  const so = res.rows[0];
  if (!so) return null;
  const phone = (so.wa_phone || so.customer_phone || '').replace(/\D/g, '').slice(-12) || null;
  return ensureFulfilment(client, {
    businessId: input.businessId,
    channel: so.is_whatsapp ? 'whatsapp' : 'sales_order',
    salesOrderId: input.salesOrderId,
    invoiceId: input.invoiceId,
    branchId: input.branchId ?? null,
    customerId: so.customer_id,
    buyerName: so.customer_name || so.wa_name,
    buyerPhone: phone,
    status: 'confirmed',
    actorType: input.actorType,
    actorUserId: input.actorUserId,
    note: input.note,
  });
}

export async function listFulfilmentEvents(
  client: Pick<PoolClient, 'query'>,
  businessId: string,
  fulfilmentId: string,
): Promise<Array<{ status: FulfilmentStatus; note: string | null; actor_type: FulfilmentActor; created_at: string }>> {
  const res = await client.query(
    `SELECT status, note, actor_type, created_at
       FROM order_fulfilment_events
      WHERE fulfilment_id = $1 AND business_id = $2
      ORDER BY created_at, id`,
    [fulfilmentId, businessId],
  );
  return res.rows;
}
