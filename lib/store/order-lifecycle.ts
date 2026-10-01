import type { PoolClient } from 'pg';
import { getPool, queryOne } from '@/lib/db';
import {
  InvoiceCancelError,
  SHIPROCKET_WEBHOOK_ACTOR,
  cancelPostedInvoiceInTransaction,
} from '@/lib/invoices/cancel-final-invoice';
import {
  canBookShipment,
  canTransitionStoreOrder,
  type StoreOrderStatus,
} from './fulfillment-rules';
import { hashStoreWebhookToken, type StoreFulfillmentStatus } from './delivery/webhooks';

export type StoreOrderLifecycleResult =
  | {
      ok: true;
      from: StoreOrderStatus;
      to: StoreOrderStatus;
      stockRestored: boolean;
      shipmentId: string | null;
    }
  | {
      ok: false;
      status: 404 | 409;
      code: 'ORDER_NOT_FOUND' | 'INVALID_TRANSITION' | 'PAYMENT_REQUIRED';
      error: string;
      from?: StoreOrderStatus;
    };

export interface StoreOrderTransitionInput {
  businessId: string;
  orderId: string;
  to: StoreOrderStatus;
  cancelledReason?: string | null;
  dispatchMode?: string | null;
  /**
   * Session user when a merchant cancels an invoiced order. Ignored when the order
   * has no invoice. A carrier cancel sets `systemActor` instead.
   */
  actorUserId?: string | null;
  /**
   * Set only by the verified Shiprocket webhook. Never read from the request body.
   */
  systemActor?: typeof SHIPROCKET_WEBHOOK_ACTOR;
  /** Kept so older callers compile. Shelf stock is no longer added back on cancel. */
  restoreStockOnCancel?: boolean;
}

/** Per-business SO-0001 series. Must run inside the transaction that inserts the order. */
export async function reserveStoreOrderNumber(client: PoolClient, businessId: string): Promise<string> {
  const res = await client.query<{ last_number: number }>(
    `INSERT INTO store_order_counters (business_id, last_number)
     SELECT $1::uuid,
            GREATEST(
              COUNT(*),
              COALESCE(MAX(SUBSTRING(order_number FROM '^SO-(\\d+)$')::bigint), 0)
            )::integer + 1
       FROM store_orders
      WHERE business_id = $1
     ON CONFLICT (business_id) DO UPDATE
       SET last_number = store_order_counters.last_number + 1, updated_at = NOW()
     RETURNING last_number`,
    [businessId],
  );
  return `SO-${String(res.rows[0].last_number).padStart(4, '0')}`;
}

async function sessionInvoiceActor(
  client: PoolClient,
  businessId: string,
  actorUserId: string | null | undefined,
): Promise<string> {
  if (!actorUserId) {
    throw new InvoiceCancelError('A session user is required to reverse the invoice', 409, 'ACTOR_REQUIRED');
  }
  const row = await client.query(
    `SELECT id FROM users WHERE id = $1 AND business_id = $2`,
    [actorUserId, businessId],
  );
  if (row.rows.length === 0) {
    throw new InvoiceCancelError('Actor does not belong to this business', 403, 'ACTOR_MISMATCH');
  }
  return actorUserId;
}

/** Locks the order row, validates the move against the lifecycle, and applies it on `client`. */
export async function transitionStoreOrderInTransaction(
  client: PoolClient,
  input: StoreOrderTransitionInput,
): Promise<StoreOrderLifecycleResult> {
  const found = await client.query<{
    status: StoreOrderStatus;
    payment_status: string;
    shipment_id: string | null;
    invoice_id: string | null;
  }>(
    `SELECT status, payment_status, shipment_id, invoice_id
       FROM store_orders
      WHERE id = $1 AND business_id = $2
      FOR UPDATE`,
    [input.orderId, input.businessId],
  );
  const order = found.rows[0];
  if (!order) {
    return { ok: false, status: 404, code: 'ORDER_NOT_FOUND', error: 'Order not found' };
  }
  if (!canTransitionStoreOrder(order.status, input.to)) {
    return {
      ok: false,
      status: 409,
      code: 'INVALID_TRANSITION',
      error: `Cannot change a ${order.status} order to ${input.to}`,
      from: order.status,
    };
  }
  if (input.to === 'ready' && !canBookShipment(order.payment_status)) {
    return {
      ok: false,
      status: 409,
      code: 'PAYMENT_REQUIRED',
      error: 'Cannot ship until payment is received',
      from: order.status,
    };
  }

  let stockRestored = false;
  if (input.to === 'cancelled' && order.invoice_id) {
    const systemActor = input.systemActor === SHIPROCKET_WEBHOOK_ACTOR ? SHIPROCKET_WEBHOOK_ACTOR : undefined;
    const userId = systemActor
      ? null
      : await sessionInvoiceActor(client, input.businessId, input.actorUserId);
    const reversed = await cancelPostedInvoiceInTransaction(client, {
      invoiceId: order.invoice_id,
      businessId: input.businessId,
      userId,
      systemActor,
      reason: input.cancelledReason?.trim() || 'Store order cancelled',
    });
    stockRestored = reversed === 'cancelled';
  }

  await client.query(
    `UPDATE store_orders
        SET status = $1::varchar,
            cancelled_reason = CASE WHEN $1::varchar = 'cancelled' THEN $2 ELSE cancelled_reason END,
            dispatch_mode = COALESCE($3, dispatch_mode),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 AND business_id = $5`,
    [input.to, input.cancelledReason ?? null, input.dispatchMode ?? null, input.orderId, input.businessId],
  );

  return { ok: true, from: order.status, to: input.to, stockRestored, shipmentId: order.shipment_id };
}

export async function transitionStoreOrder(
  input: StoreOrderTransitionInput,
): Promise<StoreOrderLifecycleResult> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await transitionStoreOrderInTransaction(client, input);
    await client.query(result.ok ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveBusinessIdForShiprocketToken(token: string): Promise<string | null> {
  if (!token) return null;
  const row = await queryOne<{ business_id: string }>(
    `SELECT business_id FROM business_settings WHERE store_shiprocket_webhook_token_hash = $1`,
    [hashStoreWebhookToken(token)],
  );
  return row?.business_id ?? null;
}

export type ShiprocketTrackingOutcome =
  | { outcome: 'not_found' }
  | { outcome: 'unchanged' | 'updated'; orderId: string }
  | { outcome: 'rejected'; orderId: string; code: string };

/** Applies a verified Shiprocket tracking event to one order of `businessId` only. */
export async function applyShiprocketTrackingUpdate(input: {
  businessId: string;
  awb: string;
  orderRef: string;
  status: StoreFulfillmentStatus;
}): Promise<ShiprocketTrackingOutcome> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<{ id: string; status: StoreOrderStatus }>(
      `SELECT id, status
         FROM store_orders
        WHERE business_id = $1
          AND (($2 <> '' AND awb = $2) OR ($3 <> '' AND (shipment_id = $3 OR order_number = $3)))
        ORDER BY ($2 <> '' AND awb = $2) DESC, created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [input.businessId, input.awb, input.orderRef],
    );
    const order = found.rows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return { outcome: 'not_found' };
    }

    let outcome: ShiprocketTrackingOutcome = { outcome: 'unchanged', orderId: order.id };
    if (order.status !== input.status) {
      const moved = await transitionStoreOrderInTransaction(client, {
        businessId: input.businessId,
        orderId: order.id,
        to: input.status,
        restoreStockOnCancel: false,
        systemActor: input.status === 'cancelled' ? SHIPROCKET_WEBHOOK_ACTOR : undefined,
      });
      if (!moved.ok) {
        await client.query('ROLLBACK');
        return { outcome: 'rejected', orderId: order.id, code: moved.code };
      }
      outcome = { outcome: 'updated', orderId: order.id };
    }

    await client.query(
      `UPDATE store_orders
          SET awb = COALESCE(NULLIF($1, ''), awb),
              tracking_url = COALESCE(tracking_url, $2),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND business_id = $4`,
      [
        input.awb,
        input.awb ? `https://shiprocket.co/tracking/${input.awb}` : null,
        order.id,
        input.businessId,
      ],
    );
    await client.query('COMMIT');
    return outcome;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
