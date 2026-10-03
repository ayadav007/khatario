import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { InvoiceCreateServiceError, createInvoiceInTransaction } from '@/lib/invoices/invoice-create-service';
import { ensureSalesOrderFulfilment } from '@/lib/fulfilment/service';
import { triggerFulfilmentNotification } from '@/lib/fulfilment/notify-trigger';
import { todayIsoDate } from '@/lib/invoices/convert-to-invoice';
import { periodGuardResponse } from '@/lib/http/period-guards';

export const dynamic = 'force-dynamic';

/**
 * POST /api/whatsapp/orders/[id]/approve
 * Approve a WhatsApp order: create a paid tax invoice (receipt via UPI) with full GST, stock and ledger posting.
 */
export const POST = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true },
  async ({ params, businessId, userId }) => {
  const orderId = params.id;
  const today = todayIsoDate();

  const { resolveBranchId } = await import('@/lib/branch-helpers');
  let invoiceBranchId: string;
  try {
    invoiceBranchId = await resolveBranchId({ branchId: null, businessId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Could not resolve branch for invoice' }, { status: 400 });
  }

  const guard = await periodGuardResponse({
    businessId,
    branchId: invoiceBranchId,
    dates: [today],
    action: 'create this invoice',
    checkGstFiled: true,
  });
  if (guard) return guard;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `SELECT so.*, c.state_code AS customer_state_code
         FROM sales_orders so
         LEFT JOIN customers c ON c.id = so.customer_id
        WHERE so.id = $1 AND so.business_id = $2
        FOR UPDATE OF so`,
      [orderId, businessId]
    );
    if (orderRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    const order = orderRes.rows[0];
    if (order.converted_invoice_id) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Order already invoiced', invoice_id: order.converted_invoice_id },
        { status: 400 }
      );
    }

    const itemsRes = await client.query(
      `SELECT soi.*, i.tax_rate AS master_tax_rate, i.hsn_sac AS master_hsn
         FROM sales_order_items soi
         LEFT JOIN items i ON i.id = soi.item_id
        WHERE soi.sales_order_id = $1
        ORDER BY soi.sort_order`,
      [orderId]
    );
    if (itemsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Order has no items' }, { status: 400 });
    }

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    let locationId: string | null = null;
    if (await isWarehouseModeEnabled(businessId)) {
      const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
      locationId = await getDefaultWarehouseForBranch(invoiceBranchId);
      if (!locationId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Warehouse mode is enabled but no default warehouse is configured for this branch.', code: 'WAREHOUSE_REQUIRED' },
          { status: 400 }
        );
      }
    }

    const lines = itemsRes.rows.map((r: any) => ({
      item_id: r.item_id || null,
      item_name: r.item_name,
      description: r.description || null,
      hsn_sac: r.hsn_sac || r.master_hsn || null,
      quantity: Number(r.qty) || 0,
      unit: r.unit || undefined,
      unit_price: Number(r.unit_price) || 0,
      discount_percent: Number(r.discount_percent) || 0,
      tax_rate: Number(r.tax_rate ?? r.master_tax_rate) || 0,
      location_id: locationId,
    }));

    const draft = await createInvoiceInTransaction(client, {
      business_id: businessId,
      created_by: userId,
      branch_id: invoiceBranchId,
      customer_id: order.customer_id || null,
      invoice_date: today,
      due_date: today,
      status: 'final',
      document_type: 'tax_invoice',
      items: lines,
      place_of_supply_state_code: order.place_of_supply_state_code || order.customer_state_code || null,
      billing_address: order.billing_address,
      shipping_address: order.shipping_address,
      notes: `WhatsApp Order ${order.order_number}`,
      channel: 'whatsapp',
      sales_order_id: orderId,
      payments: [{ amount: Number(order.grand_total) || 0, mode: 'upi', date: today, reference: order.payment_reference || undefined }],
    });

    if (Math.abs(draft.grandTotal - (Number(order.grand_total) || 0)) > 1) {
      throw new InvoiceCreateServiceError(
        `Order total ₹${Number(order.grand_total).toFixed(2)} differs from the GST-computed invoice total ₹${draft.grandTotal.toFixed(2)}. Edit the order before approving.`,
        409,
        'ORDER_TOTAL_MISMATCH'
      );
    }

    await client.query(
      `UPDATE sales_orders SET status = 'fulfilled', converted_invoice_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [draft.invoiceId, orderId]
    );
    const fulfilment = await ensureSalesOrderFulfilment(client, {
      businessId,
      salesOrderId: orderId,
      invoiceId: draft.invoiceId,
      branchId: invoiceBranchId,
      actorType: 'staff',
      actorUserId: userId,
      note: 'Payment approved',
    });

    await client.query('COMMIT');
    if (fulfilment) triggerFulfilmentNotification(businessId, { fulfilmentId: fulfilment.row.id, to: fulfilment.row.status });
    return NextResponse.json({ success: true, invoice_id: draft.invoiceId, invoice_number: draft.invoiceNumber });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof InvoiceCreateServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode });
    }
    console.error('Error approving WhatsApp order:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    client.release();
  }
});
