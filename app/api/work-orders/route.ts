import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { withPremiumSubscriptionApi } from '@/lib/security';
import { WORK_ORDER_STATUSES, writeWorkOrder, type WorkOrderWriteInput } from '@/lib/work-orders/work-order';
import { workOrderErrorResponse } from '@/lib/work-orders/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/work-orders
 * Fetch all work orders for a business
 */
export const GET = withPremiumSubscriptionApi(
  { module: 'work_orders', action: 'read' },
  async (ctx) => {
    try {
      const { searchParams } = new URL(ctx.request.url);
      const status = searchParams.get('status');

      let query = `
        SELECT
          wo.*,
          c.name as customer_name,
          inv.invoice_number as converted_invoice_number
        FROM work_orders wo
        LEFT JOIN customers c ON wo.customer_id = c.id
        LEFT JOIN invoices inv ON wo.converted_invoice_id = inv.id
        WHERE wo.business_id = $1
      `;
      const params: any[] = [ctx.businessId];

      if (status && (WORK_ORDER_STATUSES as readonly string[]).includes(status)) {
        query += ` AND wo.status = $2`;
        params.push(status);
      }

      query += ` ORDER BY wo.work_order_date DESC, wo.created_at DESC`;

      const result = await getPool().query(query, params);
      return NextResponse.json({ workOrders: result.rows });
    } catch (error: any) {
      return workOrderErrorResponse(error, 'Failed to fetch work orders');
    }
  },
);

/**
 * POST /api/work-orders
 * Create a work order. Numbering and costs are decided on the server; the creator is the session user.
 */
export const POST = withPremiumSubscriptionApi(
  { parseJsonBody: true, module: 'work_orders', action: 'create' },
  async (ctx) => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const workOrder = await writeWorkOrder(client, ctx.businessId, (ctx.body || {}) as WorkOrderWriteInput, {
        userId: ctx.userId,
      });
      await client.query('COMMIT');
      return NextResponse.json({ workOrder }, { status: 201 });
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => {});
      return workOrderErrorResponse(error, 'Failed to create work order');
    } finally {
      client.release();
    }
  },
);
