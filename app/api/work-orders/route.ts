import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { withPremiumSubscriptionApi } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/work-orders
 * Fetch all work orders for a business
 */
export const GET = withPremiumSubscriptionApi({}, async (ctx) => {
  try {
    const { searchParams } = new URL(ctx.request.url);
    const businessId = ctx.businessId;
    const status = searchParams.get('status');
    const userId = ctx.userId;

    // Check authorization
    await authorize(userId, 'work_orders', 'read', {
      businessId,
    });

    const pool = getPool();
    let query = `
      SELECT 
        wo.*,
        c.name as customer_name
      FROM work_orders wo
      LEFT JOIN customers c ON wo.customer_id = c.id
      WHERE wo.business_id = $1
    `;

    const params: any[] = [businessId];

    if (status) {
      query += ` AND wo.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY wo.work_order_date DESC, wo.created_at DESC`;

    const result = await pool.query(query, params);

    return NextResponse.json({ workOrders: result.rows });
  } catch (error: any) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 403 }
      );
    }
    console.error('Error fetching work orders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch work orders', details: error.message },
      { status: 500 }
    );
  }
});

/**
 * POST /api/work-orders
 * Create a new work order
 */
export const POST = withPremiumSubscriptionApi(
  {
    parseJsonBody: true,
    resolveActingUserId: ({ body, sessionUserId }) => {
      if (body != null && typeof body === 'object') {
        return (body as { created_by?: string }).created_by ?? sessionUserId;
      }
      return sessionUserId;
    },
  },
  async (ctx) => {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const body = ctx.body as Record<string, unknown>;
      const {
        customer_id,
        work_order_number,
        work_order_date,
        scheduled_start_date,
        scheduled_end_date,
        work_description,
        work_location,
        assigned_to,
        labor_cost = 0,
        material_cost = 0,
        other_cost = 0,
        total_cost = 0,
        estimated_hours,
        priority = 'medium',
        items = [],
        notes,
        terms,
        created_by,
      } = body as {
        customer_id?: string;
        work_order_number?: string;
        work_order_date?: string;
        scheduled_start_date?: string;
        scheduled_end_date?: string;
        work_description?: string;
        work_location?: string;
        assigned_to?: string;
        labor_cost?: number;
        material_cost?: number;
        other_cost?: number;
        total_cost?: number;
        estimated_hours?: number;
        priority?: string;
        items?: any[];
        notes?: string;
        terms?: string;
        created_by?: string;
      };

      const business_id = ctx.businessId;

      if (!work_order_number || !work_order_date || !work_description) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'business_id, work_order_number, work_order_date, and work_description are required' },
          { status: 400 }
        );
      }

      if (!created_by) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'created_by (user_id) is required for authorization' },
          { status: 400 }
        );
      }

      // Check authorization
      await authorize(created_by, 'work_orders', 'create', {
        businessId: business_id,
      });

      // Create work order
      const workOrderResult = await client.query(`
      INSERT INTO work_orders (
        business_id, customer_id, work_order_number, work_order_date,
        scheduled_start_date, scheduled_end_date, work_description, work_location,
        assigned_to, labor_cost, material_cost, other_cost, total_cost,
        estimated_hours, priority, notes, terms, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *
    `, [
        business_id,
        customer_id || null,
        work_order_number,
        work_order_date,
        scheduled_start_date || null,
        scheduled_end_date || null,
        work_description,
        work_location || null,
        assigned_to || null,
        labor_cost,
        material_cost,
        other_cost,
        total_cost,
        estimated_hours || null,
        priority,
        notes || null,
        terms || null,
        created_by || null
      ]);

      const workOrder = workOrderResult.rows[0];

      // Create work order items (materials)
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await client.query(`
        INSERT INTO work_order_items (
          work_order_id, item_id, item_name, description, hsn_sac, qty, unit, unit_price, total_cost, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
          workOrder.id,
          item.item_id || null,
          item.item_name || item.name,
          item.description || null,
          item.hsn_sac || null,
          item.qty || item.quantity,
          item.unit || 'PCS',
          item.unit_price || item.price || 0,
          item.total_cost || (item.unit_price || 0) * (item.qty || 0),
          i
        ]);
      }

      await client.query('COMMIT');

      await client.query('COMMIT');
      return NextResponse.json({ workOrder }, { status: 201 });
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error instanceof AuthorizationError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: 403 }
        );
      }
      console.error('Error creating work order:', error);
      return NextResponse.json(
        { error: 'Failed to create work order', details: error.message },
        { status: 500 }
      );
    } finally {
      client.release();
    }
  },
);
