import { NextResponse } from 'next/server';
import { getPool, queryOne, queryRows } from '@/lib/db';
import { withPremiumSubscriptionApi } from '@/lib/security';
import {
  canTransition,
  isWorkOrderEditable,
  WORK_ORDER_STATUSES,
  WorkOrderInputError,
  writeWorkOrder,
  type WorkOrderWriteInput,
} from '@/lib/work-orders/work-order';
import { workOrderErrorResponse } from '@/lib/work-orders/route-helpers';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** GET /api/work-orders/[id] — work order with its materials, for the edit form. */
export const GET = withPremiumSubscriptionApi<Params>(
  { module: 'work_orders', action: 'read' },
  async (ctx) => {
    try {
      const workOrder = await queryOne(
        `SELECT wo.*, c.name AS customer_name, inv.invoice_number AS converted_invoice_number
           FROM work_orders wo
           LEFT JOIN customers c ON c.id = wo.customer_id
           LEFT JOIN invoices inv ON inv.id = wo.converted_invoice_id
          WHERE wo.id = $1 AND wo.business_id = $2`,
        [ctx.params.id, ctx.businessId]
      );
      if (!workOrder) {
        return NextResponse.json({ error: 'Work order not found' }, { status: 404 });
      }
      const items = await queryRows(
        `SELECT * FROM work_order_items WHERE work_order_id = $1 ORDER BY sort_order, id`,
        [ctx.params.id]
      );
      return NextResponse.json({ workOrder, items });
    } catch (error: any) {
      return workOrderErrorResponse(error, 'Failed to load work order');
    }
  },
);

/** PUT /api/work-orders/[id] — replace an open (draft, scheduled or in progress) work order. */
export const PUT = withPremiumSubscriptionApi<Params>(
  { parseJsonBody: true, module: 'work_orders', action: 'update' },
  async (ctx) => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        'SELECT status FROM work_orders WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [ctx.params.id, ctx.businessId]
      );
      if (!current.rows[0]) throw new WorkOrderInputError('Work order not found', 404);
      if (!isWorkOrderEditable(current.rows[0].status)) {
        throw new WorkOrderInputError(`A ${current.rows[0].status} work order cannot be edited`, 409);
      }
      const workOrder = await writeWorkOrder(client, ctx.businessId, (ctx.body || {}) as WorkOrderWriteInput, {
        existingId: ctx.params.id,
      });
      await client.query('COMMIT');
      return NextResponse.json({ workOrder });
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => {});
      return workOrderErrorResponse(error, 'Failed to update work order');
    } finally {
      client.release();
    }
  },
);

/**
 * PATCH /api/work-orders/[id] — status change:
 * { status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled', actual_hours? }.
 * Starting records the actual start date; completing records the end date and hours.
 */
export const PATCH = withPremiumSubscriptionApi<Params>(
  { parseJsonBody: true, module: 'work_orders', action: 'update' },
  async (ctx) => {
    try {
      const body = (ctx.body || {}) as { status?: string; actual_hours?: unknown };
      const next = String(body.status || '');
      if (!(WORK_ORDER_STATUSES as readonly string[]).includes(next)) {
        throw new WorkOrderInputError('Invalid status');
      }
      let actualHours: number | null = null;
      if (body.actual_hours !== undefined && body.actual_hours !== null && body.actual_hours !== '') {
        actualHours = Number(body.actual_hours);
        if (!Number.isFinite(actualHours) || actualHours < 0) {
          throw new WorkOrderInputError('Actual hours must be a positive number');
        }
      }

      const current = await queryOne<{ status: string }>(
        'SELECT status FROM work_orders WHERE id = $1 AND business_id = $2',
        [ctx.params.id, ctx.businessId]
      );
      if (!current) throw new WorkOrderInputError('Work order not found', 404);
      if (!canTransition(current.status, next)) {
        throw new WorkOrderInputError(`Cannot change a ${current.status} work order to ${next}`, 409);
      }

      const workOrder = await queryOne(
        `UPDATE work_orders
            SET status = $3::text,
                actual_start_date = CASE WHEN $3::text IN ('in_progress', 'completed')
                                         THEN COALESCE(actual_start_date, CURRENT_DATE) ELSE actual_start_date END,
                actual_end_date = CASE WHEN $3::text = 'completed' THEN CURRENT_DATE ELSE actual_end_date END,
                completed_at = CASE WHEN $3::text = 'completed' THEN NOW() ELSE completed_at END,
                cancelled_at = CASE WHEN $3::text = 'cancelled' THEN NOW() ELSE cancelled_at END,
                actual_hours = COALESCE($5::numeric, actual_hours)
          WHERE id = $1 AND business_id = $2 AND status = $4
          RETURNING *`,
        [ctx.params.id, ctx.businessId, next, current.status, actualHours]
      );
      if (!workOrder) {
        throw new WorkOrderInputError('The work order changed meanwhile. Reload and try again.', 409);
      }
      return NextResponse.json({ workOrder });
    } catch (error: any) {
      return workOrderErrorResponse(error, 'Failed to update work order status');
    }
  },
);
