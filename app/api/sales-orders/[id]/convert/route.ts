import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { resolveBranchId } from '@/lib/branch-helpers';
import { requireTenantBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { InvoiceCreateServiceError } from '@/lib/invoices/invoice-create-service';
import { convertLinesToInvoice, todayIsoDate } from '@/lib/invoices/convert-to-invoice';
import { ensureSalesOrderFulfilment } from '@/lib/fulfilment/service';
import { triggerFulfilmentNotification } from '@/lib/fulfilment/notify-trigger';
import { periodGuardResponse } from '@/lib/http/period-guards';
import {
  billingStatusFromLines,
  isSalesOrderConvertibleStatus,
  lineRemainingQty,
} from '@/lib/sales-orders/billing-status';
import { releaseSalesOrderReservationQty } from '@/lib/stock/sales-order-reservations';

export const dynamic = 'force-dynamic';

type ConvertLineBody = { sales_order_item_id: string; quantity: number };

/**
 * POST /api/sales-orders/[id]/convert
 * Convert remaining (or selected) sales-order lines to a tax invoice.
 * Body: { invoice_date?, lines?: [{ sales_order_item_id, quantity }] }
 * Omitting lines invoices all remaining quantity (Vyapar full convert).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenant = requireTenantBusinessId(request);
  if (!tenant.ok) return tenant.response;
  const body = await request.json().catch(() => ({}));
  const userId = getUserIdFromRequest(request, body);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const salesOrderId = params.id;
  const invoiceDate = body?.invoice_date ? String(body.invoice_date).slice(0, 10) : todayIsoDate();
  const requestedLines: ConvertLineBody[] | null = Array.isArray(body?.lines)
    ? body.lines.map((l: any) => ({
        sales_order_item_id: String(l.sales_order_item_id || l.id || ''),
        quantity: Number(l.quantity),
      }))
    : null;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `SELECT so.*, c.state_code AS customer_state_code
         FROM sales_orders so
         LEFT JOIN customers c ON so.customer_id = c.id
        WHERE so.id = $1 AND so.business_id = $2
        FOR UPDATE OF so`,
      [salesOrderId, tenant.businessId]
    );
    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Sales order not found' }, { status: 404 });
    }
    const salesOrder = orderRes.rows[0];

    if (!isSalesOrderConvertibleStatus(salesOrder.status)) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `A ${salesOrder.status} sales order cannot be invoiced`, code: 'NOT_CONVERTIBLE' },
        { status: 400 }
      );
    }

    let invoiceBranchId: string;
    try {
      invoiceBranchId = await resolveBranchId({
        businessId: salesOrder.business_id,
        branchId: salesOrder.branch_id ?? null,
      });
    } catch (e: any) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: e?.message || 'Could not resolve branch for invoice' }, { status: 400 });
    }

    const guard = await periodGuardResponse({
      businessId: salesOrder.business_id,
      branchId: invoiceBranchId,
      dates: [invoiceDate],
      action: 'create this invoice',
      checkGstFiled: true,
    });
    if (guard) {
      await client.query('ROLLBACK');
      return guard;
    }

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    let defaultWarehouseId: string | null = null;
    if (await isWarehouseModeEnabled(salesOrder.business_id)) {
      const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
      defaultWarehouseId = await getDefaultWarehouseForBranch(invoiceBranchId);
      if (!defaultWarehouseId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error:
              'Warehouse mode is enabled but no default warehouse is configured for this branch. Configure a default warehouse before converting sales orders.',
            code: 'WAREHOUSE_REQUIRED',
          },
          { status: 400 }
        );
      }
    }

    const itemsRes = await client.query(
      `SELECT * FROM sales_order_items WHERE sales_order_id = $1 ORDER BY sort_order ASC, id ASC FOR UPDATE`,
      [salesOrderId]
    );
    if (itemsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Sales order has no items' }, { status: 400 });
    }

    const byId = new Map(itemsRes.rows.map((r: any) => [String(r.id), r]));
    const convertPlan: Array<{ row: any; quantity: number }> = [];

    if (requestedLines && requestedLines.length > 0) {
      for (const req of requestedLines) {
        const row = byId.get(req.sales_order_item_id);
        if (!row) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: `Unknown sales order line: ${req.sales_order_item_id}`, code: 'UNKNOWN_LINE' },
            { status: 400 }
          );
        }
        const remaining = lineRemainingQty(row);
        const qty = Number(req.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'Each convert line needs a positive quantity', code: 'INVALID_QTY' },
            { status: 400 }
          );
        }
        if (qty > remaining + 0.0001) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            {
              error: `Cannot invoice ${qty} of "${row.item_name}" — only ${remaining} remaining`,
              code: 'QTY_EXCEEDS_REMAINING',
              remaining,
            },
            { status: 400 }
          );
        }
        convertPlan.push({ row, quantity: qty });
      }
    } else {
      for (const row of itemsRes.rows) {
        const remaining = lineRemainingQty(row);
        if (remaining > 0.0001) convertPlan.push({ row, quantity: remaining });
      }
    }

    if (convertPlan.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Nothing left to invoice on this sales order', code: 'NOTHING_REMAINING' },
        { status: 400 }
      );
    }

    const result = await convertLinesToInvoice(client, {
      businessId: salesOrder.business_id,
      userId,
      branchId: invoiceBranchId,
      customerId: salesOrder.customer_id || null,
      invoiceDate,
      placeOfSupplyStateCode: salesOrder.place_of_supply_state_code || salesOrder.customer_state_code || null,
      billingAddress: salesOrder.billing_address,
      shippingAddress: salesOrder.shipping_address,
      notes: salesOrder.notes,
      locationId: defaultWarehouseId,
      channel: salesOrder.whatsapp_conversation_id ? 'whatsapp' : 'sales_order',
      salesOrderId,
      lines: convertPlan.map(({ row, quantity }) => ({
        item_id: row.item_id,
        variant_id: row.variant_id,
        item_name: row.item_name,
        description: row.description,
        hsn_sac: row.hsn_sac,
        quantity,
        unit: row.unit,
        unit_price: row.unit_price,
        discount_percent: row.discount_percent,
        tax_rate: row.tax_rate,
      })),
    });

    for (const { row, quantity } of convertPlan) {
      await client.query(
        `UPDATE sales_order_items
            SET fulfilled_qty = COALESCE(fulfilled_qty, 0) + $1
          WHERE id = $2 AND sales_order_id = $3`,
        [quantity, row.id, salesOrderId]
      );
      await releaseSalesOrderReservationQty(client, {
        businessId: salesOrder.business_id,
        salesOrderId,
        itemId: row.item_id,
        variantId: row.variant_id,
        quantity,
        userId,
      });
    }

    const refreshed = await client.query(
      `SELECT id, qty, fulfilled_qty FROM sales_order_items WHERE sales_order_id = $1`,
      [salesOrderId]
    );
    const nextStatus = billingStatusFromLines(refreshed.rows);

    await client.query(
      `UPDATE sales_orders
          SET status = $1, converted_invoice_id = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3`,
      [nextStatus, result.invoiceId, salesOrderId]
    );

    const fulfilment = await ensureSalesOrderFulfilment(client, {
      businessId: salesOrder.business_id,
      salesOrderId,
      invoiceId: result.invoiceId,
      branchId: invoiceBranchId,
      actorType: 'staff',
      actorUserId: userId,
      note: nextStatus === 'fulfilled' ? 'Fully invoiced' : 'Partially invoiced',
    });

    await client.query('COMMIT');
    if (fulfilment?.row.channel === 'whatsapp') {
      triggerFulfilmentNotification(salesOrder.business_id, { fulfilmentId: fulfilment.row.id, to: fulfilment.row.status });
    }
    return NextResponse.json(
      {
        invoice: result.invoice,
        sales_order_id: salesOrderId,
        sales_order_status: nextStatus,
        partial: nextStatus === 'partially_fulfilled',
      },
      { status: 201 }
    );
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof InvoiceCreateServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...(error.details || {}) },
        { status: error.statusCode }
      );
    }
    const status = typeof error?.statusCode === 'number' ? error.statusCode : 500;
    console.error('Error converting sales order:', error);
    return NextResponse.json(
      { error: status === 500 ? 'Failed to convert sales order' : error.message, details: error.message },
      { status }
    );
  } finally {
    client.release();
  }
}
