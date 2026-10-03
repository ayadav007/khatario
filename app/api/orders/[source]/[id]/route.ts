import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { orderTrackingUrl } from '@/lib/customer-surface/urls';
import {
  getOrderHubRow,
  isHubSource,
  loadOrderFulfilments,
  loadOrderLines,
  loadShipFrom,
  loadShipTo,
  type HubSource,
  type OrderHubRow,
} from '@/lib/fulfilment/hub';
import { resolveHubAuth } from '@/lib/fulfilment/hub-scope';
import { triggerFulfilmentNotification } from '@/lib/fulfilment/notify-trigger';
import { isFulfilmentMethod, isFulfilmentStatus, type FulfilmentMethod, type FulfilmentStatus } from '@/lib/fulfilment/rules';
import {
  addShipment,
  ensureFulfilment,
  markCodCollected,
  setFulfilmentShipping,
  syncStoreOrderFulfilment,
  transitionFulfilment,
  type FulfilmentDetails,
  type FulfilmentShipping,
} from '@/lib/fulfilment/service';
import { isInvoiceChannel } from '@/lib/invoices/channel';
import { InvoiceCancelError } from '@/lib/invoices/cancel-final-invoice';
import { applyStoreOrderStatus, syncStoreFulfilmentQuietly, type StoreDispatchMode } from '@/lib/store/apply-store-status';
import type { StoreOrderStatus } from '@/lib/store/fulfillment-rules';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ source: string; id: string }> | { source: string; id: string } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveParams(ctx: Ctx): Promise<{ source: HubSource; id: string } | null> {
  const p = await ctx.params;
  if (!isHubSource(p.source) || !UUID_RE.test(p.id)) return null;
  return { source: p.source, id: p.id };
}

async function detail(businessId: string, row: OrderHubRow) {
  const [lines, fulfilments, shipTo, shipFrom] = await Promise.all([
    loadOrderLines(businessId, row.source_type, row.source_id),
    loadOrderFulfilments(businessId, row.source_type, row.source_id),
    loadShipTo(businessId, row.source_type, row.source_id),
    loadShipFrom(businessId),
  ]);
  return {
    order: row,
    lines,
    ship_to: shipTo,
    ship_from: shipFrom,
    fulfilments: fulfilments.map((f) => ({
      ...f,
      public_url: f.public_token ? orderTrackingUrl(f.public_token) : null,
    })),
  };
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await resolveHubAuth(request, 'read');
  if (!auth.ok) return auth.response;
  const p = await resolveParams(ctx);
  if (!p) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const row = await getOrderHubRow(auth.scope, p.source, p.id);
  if (!row) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  return NextResponse.json(await detail(auth.scope.businessId, row));
}

function str(v: unknown, max = 200): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function parseDetails(raw: unknown): FulfilmentDetails {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: FulfilmentDetails = {};
  if (d.method !== undefined) out.method = isFulfilmentMethod(d.method) ? d.method : null;
  if (d.partner_name !== undefined) out.partnerName = str(d.partner_name, 100);
  if (d.awb !== undefined) out.awb = str(d.awb, 100);
  if (d.tracking_url !== undefined) out.trackingUrl = str(d.tracking_url, 1000);
  if (d.rider_name !== undefined) out.riderName = str(d.rider_name, 100);
  if (d.rider_phone !== undefined) out.riderPhone = str(d.rider_phone, 20);
  if (d.proof_photo_url !== undefined) out.proofPhotoUrl = str(d.proof_photo_url, 1000);
  if (d.failure_reason !== undefined) out.failureReason = str(d.failure_reason, 500);
  if (d.cod_amount !== undefined) {
    const n = Number(d.cod_amount);
    out.codAmount = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return out;
}

function parseShipping(raw: unknown): FulfilmentShipping | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const out: FulfilmentShipping = {};
  if (s.address !== undefined) out.address = str(s.address, 500);
  if (s.pincode !== undefined) out.pincode = str(s.pincode, 10);
  if (s.packages !== undefined) out.packages = Number(s.packages);
  return out;
}

/** Fulfilment status onto the coarse store order status, when it changes the store order at all. */
function storeTargetFor(to: FulfilmentStatus, current: string): StoreOrderStatus | null {
  const map: Partial<Record<FulfilmentStatus, StoreOrderStatus>> = {
    confirmed: 'confirmed',
    ready_for_pickup: 'ready',
    shipped: 'ready',
    out_for_delivery: 'ready',
    delivered: 'delivered',
    cancelled: 'cancelled',
  };
  const target = map[to] ?? null;
  return target && target !== current ? target : null;
}

function dispatchModeFor(method: FulfilmentMethod | null | undefined, to: FulfilmentStatus): StoreDispatchMode | null {
  if (to === 'ready_for_pickup' || method === 'pickup') return 'pickup';
  if (method === 'shiprocket') return 'shiprocket';
  if (method) return 'self';
  return null;
}

async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function firstOrStart(c: PoolClient, businessId: string, row: OrderHubRow, userId: string): Promise<string> {
  if (row.fulfilment_id) return row.fulfilment_id;
  if (row.source_type === 'store_order') {
    await syncStoreOrderFulfilment(c, { businessId, storeOrderId: row.source_id, actorType: 'staff', actorUserId: userId });
    const r = await c.query<{ id: string }>(
      `SELECT id FROM order_fulfilments WHERE business_id = $1 AND store_order_id = $2 ORDER BY seq LIMIT 1`,
      [businessId, row.source_id],
    );
    if (!r.rows[0]) throw new Error('Store order delivery record could not be created');
    return r.rows[0].id;
  }
  const channel = isInvoiceChannel(row.channel) ? row.channel : 'manual';
  const status: FulfilmentStatus =
    isFulfilmentStatus(row.delivery_status) && row.delivery_status !== 'new' ? row.delivery_status : 'confirmed';
  const { row: f } = await ensureFulfilment(c, {
    businessId,
    channel,
    salesOrderId: row.source_type === 'sales_order' ? row.source_id : null,
    invoiceId: row.invoice_id,
    branchId: row.branch_id,
    customerId: row.customer_id,
    buyerName: row.customer_name,
    buyerPhone: row.customer_phone,
    status,
    method: channel === 'counter' ? 'pickup' : null,
    actorType: 'staff',
    actorUserId: userId,
    note: 'Delivery tracking started',
  });
  return f.id;
}

/**
 * POST /api/orders/{source}/{id}
 * Actions: start | transition {to, details, note, pickup_code} | cod_collected | add_shipment.
 * Store orders move through the store lifecycle (invoice, courier booking) first.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await resolveHubAuth(request, 'update');
  if (!auth.ok) return auth.response;
  const p = await resolveParams(ctx);
  if (!p) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const { businessId } = auth.scope;
  const row = await getOrderHubRow(auth.scope, p.source, p.id);
  if (!row) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');
  const own = await loadOrderFulfilments(businessId, row.source_type, row.source_id);
  const requested = typeof body.fulfilment_id === 'string' ? body.fulfilment_id : null;
  if (requested && !own.some((f) => f.id === requested)) {
    return NextResponse.json({ error: 'Shipment not found on this order' }, { status: 404 });
  }

  if (action === 'start') {
    if (row.source_type === 'store_order') {
      await syncStoreFulfilmentQuietly(businessId, row.source_id, auth.userId);
    } else {
      await inTx((c) => firstOrStart(c, businessId, row, auth.userId));
    }
  } else if (action === 'add_shipment') {
    const base = requested ?? own[0]?.id;
    if (!base) return NextResponse.json({ error: 'Start delivery tracking first' }, { status: 409 });
    await inTx((c) => addShipment(c, { businessId, fulfilmentId: base, actorUserId: auth.userId }));
  } else if (action === 'cod_collected') {
    const target = requested ?? own[0]?.id;
    if (!target) return NextResponse.json({ error: 'No cash on delivery on this order' }, { status: 409 });
    if (row.source_type === 'store_order') {
      const { createInvoiceForStoreOrder } = await import('@/lib/store/fulfill-paid-order');
      const { collectStoreOrderCash, StoreCashCollectError } = await import('@/lib/store/store-receipt');
      try {
        await createInvoiceForStoreOrder(row.source_id, businessId, auth.userId);
        await collectStoreOrderCash(row.source_id, businessId, auth.userId);
      } catch (err) {
        if (err instanceof StoreCashCollectError) {
          return NextResponse.json({ error: err.message, code: err.code }, { status: err.statusCode });
        }
        const message = err instanceof Error ? err.message : 'Cash could not be recorded';
        return NextResponse.json({ error: message, code: 'STORE_INVOICE_FAILED' }, { status: 409 });
      }
      await syncStoreFulfilmentQuietly(businessId, row.source_id, auth.userId);
    }
    const res = await inTx((c) => markCodCollected(c, { businessId, fulfilmentId: target, actorUserId: auth.userId }));
    if (!res.ok) return NextResponse.json({ error: 'No cash on delivery on this shipment' }, { status: 409 });
  } else if (action === 'set_shipping') {
    const shipping = parseShipping(body.shipping);
    if (!shipping) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 });
    await inTx(async (c) => {
      const target = requested ?? (await firstOrStart(c, businessId, row, auth.userId));
      await setFulfilmentShipping(c, { businessId, fulfilmentId: target, ...shipping });
    });
  } else if (action === 'transition') {
    if (!isFulfilmentStatus(body.to)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    const to = body.to;
    const details = parseDetails(body.details);
    const note = str(body.note, 500) ?? null;
    const shipping = parseShipping(body.shipping);

    if (to === 'shipped' && details.method !== 'pickup') {
      const current = requested ? own.find((x) => x.id === requested) : own[0];
      const saved = (current as { ship_address?: string | null } | undefined)?.ship_address;
      const override = shipping?.address !== undefined ? shipping.address : saved;
      const address = override || (await loadShipTo(businessId, row.source_type, row.source_id)).address;
      if (!address) {
        return NextResponse.json(
          { error: 'Add the delivery address before dispatching', code: 'ADDRESS_REQUIRED' },
          { status: 422 },
        );
      }
    }

    if (row.source_type === 'store_order' && (!requested || requested === own[0]?.id)) {
      const storeTo = storeTargetFor(to, row.order_status);
      if (storeTo) {
        try {
          const { moved } = await applyStoreOrderStatus({
            businessId,
            orderId: row.source_id,
            to: storeTo,
            dispatchMode: storeTo === 'ready' ? dispatchModeFor(details.method, to) : null,
            cancelledReason: storeTo === 'cancelled' ? note : null,
            actorUserId: auth.userId,
          });
          if (!moved.ok) {
            return NextResponse.json({ error: moved.error, code: moved.code }, { status: moved.status });
          }
        } catch (error) {
          if (error instanceof InvoiceCancelError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode });
          }
          throw error;
        }
      }
    }

    const fresh = row.source_type === 'store_order' ? await getOrderHubRow(auth.scope, row.source_type, row.source_id) : row;
    const result = await inTx(async (c) => {
      const fulfilmentId =
        requested ?? (await firstOrStart(c, businessId, { ...row, fulfilment_id: fresh?.fulfilment_id ?? null }, auth.userId));
      if (shipping) await setFulfilmentShipping(c, { businessId, fulfilmentId, ...shipping });
      const moved = await transitionFulfilment(c, {
        businessId,
        fulfilmentId,
        to,
        actorType: 'staff',
        actorUserId: auth.userId,
        note,
        details,
        pickupCode: str(body.pickup_code, 8) ?? null,
        requirePickupCode: true,
        skipPaymentGate: row.source_type === 'store_order',
      });
      if (moved.ok && moved.changed && to === 'cancelled' && row.source_type === 'sales_order' && !row.invoice_id) {
        await c.query(
          `UPDATE sales_orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND business_id = $2 AND converted_invoice_id IS NULL`,
          [row.source_id, businessId],
        );
      }
      return moved;
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    if (result.changed) triggerFulfilmentNotification(businessId, { fulfilmentId: result.fulfilmentId, to: result.to });
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const updated = await getOrderHubRow(auth.scope, row.source_type, row.source_id);
  return NextResponse.json(updated ? await detail(businessId, updated) : { ok: true });
}
