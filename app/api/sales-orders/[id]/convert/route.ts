import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { resolveBranchId } from '@/lib/branch-helpers';
import { requireTenantBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { InvoiceCreateServiceError } from '@/lib/invoices/invoice-create-service';
import { convertLinesToInvoice, todayIsoDate } from '@/lib/invoices/convert-to-invoice';
import { ensureSalesOrderFulfilment } from '@/lib/fulfilment/service';
import { triggerFulfilmentNotification } from '@/lib/fulfilment/notify-trigger';
import { periodGuardResponse } from '@/lib/http/period-guards';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sales-orders/[id]/convert
 * Convert a sales order to a final tax invoice (body: { invoice_date? } — defaults to today).
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

    if (salesOrder.converted_invoice_id) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Sales order already converted', invoice_id: salesOrder.converted_invoice_id },
        { status: 400 }
      );
    }
    if (['cancelled', 'rejected'].includes(String(salesOrder.status || '').toLowerCase())) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: `A ${salesOrder.status} sales order cannot be invoiced` }, { status: 400 });
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
      `SELECT * FROM sales_order_items WHERE sales_order_id = $1 ORDER BY sort_order ASC`,
      [salesOrderId]
    );
    if (itemsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Sales order has no items' }, { status: 400 });
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
      lines: itemsRes.rows.map((r: any) => ({
        item_id: r.item_id,
        variant_id: r.variant_id,
        item_name: r.item_name,
        description: r.description,
        hsn_sac: r.hsn_sac,
        quantity: r.qty ?? r.quantity,
        unit: r.unit,
        unit_price: r.unit_price,
        discount_percent: r.discount_percent,
        tax_rate: r.tax_rate,
      })),
    });

    await client.query(
      `UPDATE sales_orders
          SET status = 'fulfilled', converted_invoice_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
      [result.invoiceId, salesOrderId]
    );
    const fulfilment = await ensureSalesOrderFulfilment(client, {
      businessId: salesOrder.business_id,
      salesOrderId,
      invoiceId: result.invoiceId,
      branchId: invoiceBranchId,
      actorType: 'staff',
      actorUserId: userId,
      note: 'Invoiced',
    });

    await client.query('COMMIT');
    if (fulfilment?.row.channel === 'whatsapp') {
      triggerFulfilmentNotification(salesOrder.business_id, { fulfilmentId: fulfilment.row.id, to: fulfilment.row.status });
    }
    return NextResponse.json({ invoice: result.invoice, sales_order_id: salesOrderId }, { status: 201 });
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
