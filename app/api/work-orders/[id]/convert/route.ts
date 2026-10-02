import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize } from '@/lib/authorization';
import { resolveBranchId } from '@/lib/branch-helpers';
import { withPremiumSubscriptionApi } from '@/lib/security';
import { convertLinesToInvoice, todayIsoDate } from '@/lib/invoices/convert-to-invoice';
import { periodGuardResponse } from '@/lib/http/period-guards';
import { buildWorkOrderInvoiceLines, WorkOrderInputError } from '@/lib/work-orders/work-order';
import { workOrderErrorResponse } from '@/lib/work-orders/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/work-orders/[id]/convert
 * Raise a tax invoice for a completed work order (body: { invoice_date? } — defaults to today).
 * Materials become item lines (stock is issued), labour and other charges become service lines.
 */
export const POST = withPremiumSubscriptionApi<{ id: string }>(
  { parseJsonBody: true, module: 'work_orders', action: 'update' },
  async (ctx) => {
    const body = (ctx.body || {}) as { invoice_date?: string };
    const invoiceDate = body.invoice_date ? String(body.invoice_date).slice(0, 10) : todayIsoDate();

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      const woRes = await client.query(
        `SELECT wo.*, c.state_code AS customer_state_code, c.billing_address AS customer_billing_address,
                c.shipping_address AS customer_shipping_address
           FROM work_orders wo
           LEFT JOIN customers c ON wo.customer_id = c.id
          WHERE wo.id = $1 AND wo.business_id = $2
          FOR UPDATE OF wo`,
        [ctx.params.id, ctx.businessId]
      );
      const wo = woRes.rows[0];
      if (!wo) throw new WorkOrderInputError('Work order not found', 404);
      if (wo.converted_invoice_id) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'An invoice has already been raised for this work order', invoice_id: wo.converted_invoice_id },
          { status: 409 }
        );
      }
      if (wo.status !== 'completed') {
        throw new WorkOrderInputError('Mark the work order as completed before raising the invoice', 409);
      }

      const branchId = await resolveBranchId({ businessId: ctx.businessId, branchId: wo.branch_id ?? null });
      await authorize(ctx.userId, 'invoices', 'create', { businessId: ctx.businessId, branchId });

      const guard = await periodGuardResponse({
        businessId: ctx.businessId,
        branchId,
        dates: [invoiceDate],
        action: 'create this invoice',
        checkGstFiled: true,
      });
      if (guard) {
        await client.query('ROLLBACK');
        return guard;
      }

      const itemsRes = await client.query(
        `SELECT * FROM work_order_items WHERE work_order_id = $1 ORDER BY sort_order, id`,
        [wo.id]
      );
      const lines = buildWorkOrderInvoiceLines(wo, itemsRes.rows);
      if (lines.length === 0) {
        throw new WorkOrderInputError('The work order has no labour cost or materials to invoice');
      }

      let locationId: string | null = null;
      if (lines.some((l) => l.item_id)) {
        const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
        if (await isWarehouseModeEnabled(ctx.businessId)) {
          const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
          locationId = await getDefaultWarehouseForBranch(branchId);
          if (!locationId) {
            throw new WorkOrderInputError(
              'Warehouse mode is enabled but this branch has no default warehouse. Set one before invoicing materials.'
            );
          }
        }
      }

      const result = await convertLinesToInvoice(client, {
        businessId: ctx.businessId,
        userId: ctx.userId,
        branchId,
        customerId: wo.customer_id || null,
        invoiceDate,
        placeOfSupplyStateCode: wo.place_of_supply_state_code || wo.customer_state_code || null,
        billingAddress: wo.customer_billing_address,
        shippingAddress: wo.work_location || wo.customer_shipping_address,
        notes: wo.notes,
        locationId,
        lines,
      });

      await client.query(
        `UPDATE work_orders SET converted_invoice_id = $1 WHERE id = $2`,
        [result.invoiceId, wo.id]
      );

      await client.query('COMMIT');
      return NextResponse.json({ invoice: result.invoice, work_order_id: wo.id }, { status: 201 });
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => {});
      return workOrderErrorResponse(error, 'Failed to raise invoice for work order');
    } finally {
      client.release();
    }
  },
);
