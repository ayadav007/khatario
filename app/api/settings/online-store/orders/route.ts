import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';
import { getAuthenticatedUserId, requireTenantBusinessId } from '@/lib/auth-helpers';
import { InvoiceCancelError } from '@/lib/invoices/cancel-final-invoice';
import { resolveDeliveryProvider } from '@/lib/store/delivery';
import { isStoreOrderStatus } from '@/lib/store/fulfillment-rules';
import { transitionStoreOrder } from '@/lib/store/order-lifecycle';
import { accountOutstandingStoreOrders, createInvoiceForStoreOrder } from '@/lib/store/fulfill-paid-order';
import { refundStoreOrder, StoreRefundError } from '@/lib/store/store-refund';
import { collectStoreOrderCash, StoreCashCollectError } from '@/lib/store/store-receipt';
import { bookStoreCourierIfNeeded, markSelfDispatch } from '@/lib/store/book-store-shipment';
import { looksLikeCourierBarcode, matchPackScan } from '@/lib/store/fulfillment-scan';

export const dynamic = 'force-dynamic';

const VALID_DISPATCH = ['pickup', 'self', 'shiprocket'];

const ORDER_SELECT = `
  so.id, so.order_number, so.customer_name, so.customer_phone,
  so.customer_email, so.customer_address, so.customer_pincode,
  so.delivery_mode, so.status, so.notes, so.payment_status, so.payment_provider,
  so.subtotal::text, so.tax_total::text, so.delivery_charge::text, so.grand_total::text,
  so.cancelled_reason, so.created_at, so.awb, so.tracking_url, so.shipment_id,
  so.invoice_id, so.dispatch_mode, so.courier_scanned_at, so.cash_collected_at,
  br.name AS branch_name,
  (SELECT COUNT(*)::int FROM store_order_items soi WHERE soi.order_id = so.id) AS line_count,
  (SELECT COUNT(*)::int FROM store_order_items soi
    WHERE soi.order_id = so.id AND COALESCE(soi.packed_qty, 0) >= soi.quantity) AS packed_lines
`;

function mapOrder(o: Record<string, unknown>) {
  return {
    ...o,
    subtotal: parseFloat(o.subtotal as string) || 0,
    tax_total: parseFloat(o.tax_total as string) || 0,
    delivery_charge: parseFloat(o.delivery_charge as string) || 0,
    grand_total: parseFloat(o.grand_total as string) || 0,
    line_count: Number(o.line_count) || 0,
    packed_lines: Number(o.packed_lines) || 0,
  };
}

async function loadItems(orderId: string) {
  const rows = await queryRows<{
    id: string;
    item_id: string;
    variant_id: string | null;
    item_name: string;
    variant_name: string | null;
    quantity: string;
    packed_qty: string;
    unit: string;
    unit_price: string;
    line_total: string;
    barcode: string | null;
    code: string | null;
  }>(
    `SELECT
       soi.id, soi.item_id, soi.variant_id, soi.item_name, soi.variant_name,
       soi.quantity::text, COALESCE(soi.packed_qty, 0)::text AS packed_qty,
       soi.unit, soi.unit_price::text, soi.line_total::text,
       COALESCE(iv.barcode, i.barcode) AS barcode,
       COALESCE(NULLIF(iv.sku, ''), NULLIF(i.code, '')) AS code
     FROM store_order_items soi
     INNER JOIN items i ON i.id = soi.item_id
     LEFT JOIN item_variants iv ON iv.id = soi.variant_id
     WHERE soi.order_id = $1
     ORDER BY soi.item_name`,
    [orderId],
  );
  return rows.map((r) => ({
    ...r,
    quantity: parseFloat(r.quantity) || 0,
    packed_qty: parseFloat(r.packed_qty) || 0,
    unit_price: parseFloat(r.unit_price) || 0,
    line_total: parseFloat(r.line_total) || 0,
  }));
}

async function loadOrder(orderId: string, businessId: string) {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${ORDER_SELECT}
     FROM store_orders so
     LEFT JOIN branches br ON br.id = so.branch_id
     WHERE so.id = $1 AND so.business_id = $2`,
    [orderId, businessId],
  );
  if (!row) return null;
  return { order: mapOrder(row), items: await loadItems(orderId) };
}

/**
 * GET /api/settings/online-store/orders
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  const businessId = tenant.businessId;
  await accountOutstandingStoreOrders(businessId, getAuthenticatedUserId(request)).catch((err) => {
    console.error('[store invoice]', err);
  });

  const orderId = searchParams.get('order_id');
  if (orderId) {
    const detail = await loadOrder(orderId, businessId);
    if (!detail) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    return NextResponse.json(detail);
  }

  const status = searchParams.get('status');
  const q = searchParams.get('q')?.trim();
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));
  const offset = (page - 1) * limit;

  const conditions = ['so.business_id = $1'];
  const params: unknown[] = [businessId];
  let idx = 1;

  if (status) {
    idx++;
    conditions.push(`so.status = $${idx}`);
    params.push(status);
  }
  if (q) {
    idx++;
    conditions.push(
      `(so.order_number ILIKE $${idx} OR so.customer_phone ILIKE $${idx} OR so.customer_name ILIKE $${idx} OR COALESCE(so.awb,'') ILIKE $${idx})`,
    );
    params.push(`%${q}%`);
  }

  const where = conditions.join(' AND ');
  idx++;
  params.push(limit);
  const limitIdx = idx;
  idx++;
  params.push(offset);
  const offsetIdx = idx;

  const orders = await queryRows<Record<string, unknown>>(
    `SELECT ${ORDER_SELECT}
     FROM store_orders so
     LEFT JOIN branches br ON br.id = so.branch_id
     WHERE ${where}
     ORDER BY so.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM store_orders so WHERE ${where}`,
    params.slice(0, params.length - 2),
  );

  return NextResponse.json({
    orders: orders.map(mapOrder),
    total: parseInt(countRow?.count ?? '0', 10),
    page,
    limit,
  });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const tenant = requireTenantBusinessId(request, body.business_id);
  if (!tenant.ok) return tenant.response;
  const businessId = tenant.businessId;

  const action = typeof body.action === 'string' ? body.action : null;
  const orderId = body.order_id as string | undefined;

  if (action === 'scan') {
    return handleScan(businessId, body);
  }
  if (action === 'refund') {
    if (!orderId) return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
    const actorUserId = getAuthenticatedUserId(request);
    if (!actorUserId) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    try {
      const result = await refundStoreOrder({ businessId, orderId, actorUserId });
      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof StoreRefundError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode });
      }
      throw error;
    }
  }

  if (action === 'collect_cash') {
    if (!orderId) return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
    const actorUserId = getAuthenticatedUserId(request);
    try {
      await createInvoiceForStoreOrder(orderId, businessId, actorUserId);
    } catch (err) {
      console.error('[store invoice on cash collect]', err);
      const message = err instanceof Error ? err.message : 'The sale could not be posted to the accounts';
      return NextResponse.json({ error: message, code: 'STORE_INVOICE_FAILED' }, { status: 409 });
    }
    try {
      await collectStoreOrderCash(orderId, businessId, actorUserId);
    } catch (err) {
      if (err instanceof StoreCashCollectError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.statusCode });
      }
      throw err;
    }
    const detail = await loadOrder(orderId, businessId);
    return NextResponse.json({ success: true, kind: 'cash', ...detail });
  }

  if (!orderId) {
    return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
  }

  const { status, cancelled_reason } = body;
  const dispatchMode =
    typeof body.dispatch_mode === 'string' && VALID_DISPATCH.includes(body.dispatch_mode)
      ? (body.dispatch_mode as string)
      : null;

  if (!isStoreOrderStatus(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const actorUserId = getAuthenticatedUserId(request);
  let moved;
  try {
    moved = await transitionStoreOrder({
      businessId,
      orderId,
      to: status,
      cancelledReason: typeof cancelled_reason === 'string' ? cancelled_reason : null,
      dispatchMode,
      actorUserId,
    });
  } catch (error) {
    if (error instanceof InvoiceCancelError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode });
    }
    throw error;
  }
  if (!moved.ok) {
    return NextResponse.json(
      { error: moved.error, code: moved.code, current_status: moved.from ?? null },
      { status: moved.status },
    );
  }

  if (status === 'cancelled' && moved.shipmentId && moved.shipmentId !== 'self') {
    try {
      const provider = await resolveDeliveryProvider(businessId);
      await provider.cancelShipment?.(moved.shipmentId);
    } catch (err) {
      console.error('[store cancel shipment]', err);
    }
  }

  let invoiceError: string | null = null;
  if (status === 'confirmed') {
    try {
      await createInvoiceForStoreOrder(orderId, businessId, getAuthenticatedUserId(request));
    } catch (err) {
      console.error('[store invoice on confirm]', err);
      invoiceError = err instanceof Error ? err.message : 'The sale could not be posted to the accounts';
    }
  }

  if (status === 'ready') {
    if (dispatchMode === 'self' || dispatchMode === 'pickup') {
      await markSelfDispatch(orderId, businessId);
      if (dispatchMode === 'pickup') {
        await query(
          `UPDATE store_orders SET dispatch_mode = 'pickup', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND business_id = $2`,
          [orderId, businessId],
        );
      }
    } else {
      await bookStoreCourierIfNeeded(orderId, businessId);
    }
  }

  const detail = await loadOrder(orderId, businessId);
  return NextResponse.json({ success: true, invoice_error: invoiceError, ...detail });
}

async function handleScan(businessId: string, body: Record<string, unknown>) {
  const code = String(body.barcode ?? '').trim();
  if (code.length < 2) {
    return NextResponse.json({ error: 'barcode is required' }, { status: 400 });
  }
  const preferredOrderId = typeof body.order_id === 'string' ? body.order_id : null;

  const byNumber = await queryOne<{ id: string }>(
    `SELECT id FROM store_orders
     WHERE business_id = $1 AND UPPER(order_number) = UPPER($2)
       AND status != 'cancelled'
     LIMIT 1`,
    [businessId, code],
  );
  if (byNumber) {
    const detail = await loadOrder(byNumber.id, businessId);
    return NextResponse.json({ success: true, kind: 'select_order', ...detail });
  }

  const byAwb = await queryOne<{ id: string }>(
    `SELECT id FROM store_orders
     WHERE business_id = $1 AND awb IS NOT NULL AND UPPER(awb) = UPPER($2)
     LIMIT 1`,
    [businessId, code],
  );
  if (byAwb) {
    const detail = await loadOrder(byAwb.id, businessId);
    return NextResponse.json({ success: true, kind: 'select_order', ...detail });
  }

  const packCandidates = preferredOrderId
    ? await loadItems(preferredOrderId)
    : [];
  let packHit = preferredOrderId ? matchPackScan(packCandidates, code) : null;
  let packOrderId = preferredOrderId;

  if (!packHit) {
    const fifo = await queryOne<{
      id: string;
      order_id: string;
      item_name: string;
      quantity: string;
      packed_qty: string;
      barcode: string | null;
      code: string | null;
    }>(
      `SELECT soi.id, soi.order_id, soi.item_name, soi.quantity::text,
              COALESCE(soi.packed_qty, 0)::text AS packed_qty,
              COALESCE(iv.barcode, i.barcode) AS barcode,
              COALESCE(NULLIF(iv.sku, ''), NULLIF(i.code, '')) AS code
       FROM store_order_items soi
       INNER JOIN store_orders so ON so.id = soi.order_id
       INNER JOIN items i ON i.id = soi.item_id
       LEFT JOIN item_variants iv ON iv.id = soi.variant_id
       WHERE so.business_id = $1
         AND so.status IN ('pending', 'confirmed', 'ready')
         AND COALESCE(soi.packed_qty, 0) < soi.quantity
         AND (
           UPPER(COALESCE(iv.barcode, i.barcode, '')) = UPPER($2)
           OR UPPER(COALESCE(iv.sku, i.code, '')) = UPPER($2)
         )
       ORDER BY so.created_at ASC
       LIMIT 1`,
      [businessId, code],
    );
    if (fifo) {
      packHit = {
        id: fifo.id,
        item_name: fifo.item_name,
        quantity: parseFloat(fifo.quantity) || 0,
        packed_qty: parseFloat(fifo.packed_qty) || 0,
        barcode: fifo.barcode,
        code: fifo.code,
      };
      packOrderId = fifo.order_id;
    }
  }

  if (packHit && packOrderId) {
    await query(
      `UPDATE store_order_items
       SET packed_qty = LEAST(quantity, COALESCE(packed_qty, 0) + 1)
       WHERE id = $1`,
      [packHit.id],
    );
    const detail = await loadOrder(packOrderId, businessId);
    const fully = (detail?.items ?? []).every((l) => l.packed_qty >= l.quantity);
    return NextResponse.json({
      success: true,
      kind: 'packed',
      item_name: packHit.item_name,
      fully_packed: fully,
      ...detail,
    });
  }

  const awbTarget = preferredOrderId;
  if (awbTarget && looksLikeCourierBarcode(code)) {
    const own = await queryOne<{ id: string }>(
      `SELECT id FROM store_orders WHERE id = $1 AND business_id = $2`,
      [awbTarget, businessId],
    );
    if (!own) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    await query(
      `UPDATE store_orders
       SET awb = $1, courier_scanned_at = CURRENT_TIMESTAMP,
           dispatch_mode = COALESCE(dispatch_mode, 'self'),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND business_id = $3`,
      [code, awbTarget, businessId],
    );
    const detail = await loadOrder(awbTarget, businessId);
    return NextResponse.json({ success: true, kind: 'awb', ...detail });
  }

  return NextResponse.json(
    { error: 'Unknown barcode. Scan an item, packing-slip order number, or courier AWB.' },
    { status: 404 },
  );
}
