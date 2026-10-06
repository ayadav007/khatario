import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getAuthenticatedUserId,
  requireTenantBusinessId,
} from '@/lib/auth-helpers';
import { hasTableColumn } from '@/lib/schema-columns';
import {
  isSalesOrderEditable,
  isSalesOrderEditableStatus,
} from '@/lib/sales-orders/editability';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sales-orders/[id]
 * Fetch a single sales order with line items and customer fields.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const tenant = requireTenantBusinessId(request);
    if (!tenant.ok) return tenant.response;

    const userId = getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orderId = params.id;
    const pool = getPool();
    const hasBranchId = await hasTableColumn('sales_orders', 'branch_id');

    const orderResult = await pool.query(
      `SELECT
         so.*,
         c.name AS customer_name,
         c.phone AS customer_phone,
         c.email AS customer_email,
         c.gstin AS customer_gstin,
         c.state AS customer_state,
         c.state_code AS customer_state_code
       FROM sales_orders so
       LEFT JOIN customers c ON so.customer_id = c.id
       WHERE so.id = $1 AND so.business_id = $2`,
      [orderId, tenant.businessId]
    );

    if (orderResult.rows.length === 0) {
      return NextResponse.json({ error: 'Sales order not found' }, { status: 404 });
    }

    const salesOrder = orderResult.rows[0] as Record<string, unknown>;
    if (!hasBranchId) {
      salesOrder.branch_id = null;
    }

    try {
      await authorize(userId, 'sales_orders', 'read', {
        branchId: (salesOrder.branch_id as string | null) ?? undefined,
        businessId: tenant.businessId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const itemsResult = await pool.query(
      `SELECT *
       FROM sales_order_items
       WHERE sales_order_id = $1
       ORDER BY sort_order, id`,
      [orderId]
    );

    salesOrder.items = itemsResult.rows;
    salesOrder.editable = isSalesOrderEditable({
      status: salesOrder.status as string | null,
      converted_invoice_id: salesOrder.converted_invoice_id as string | null,
    });

    return NextResponse.json({ salesOrder });
  } catch (error: unknown) {
    console.error('[sales-orders/[id] GET]', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch sales order',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/sales-orders/[id]
 * Update header + replace line items. Draft/confirmed only; not after invoice conversion.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const tenant = requireTenantBusinessId(request);
    if (!tenant.ok) return tenant.response;

    const userId = getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orderId = params.id;
    const body = await request.json().catch(() => ({}));
    const {
      customer_id,
      order_number,
      order_date,
      expected_delivery_date,
      items,
      subtotal = 0,
      discount_total = 0,
      tax_total = 0,
      round_off = 0,
      grand_total = 0,
      additional_charges = 0,
      additional_charges_label,
      shipping_address,
      billing_address,
      place_of_supply_state_code,
      notes,
      terms,
      status = 'draft',
    } = body;

    if (!customer_id || !order_number || !order_date || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'customer_id, order_number, order_date, and items are required' },
        { status: 400 }
      );
    }

    const nextStatus = String(status || 'draft').toLowerCase();
    if (!isSalesOrderEditableStatus(nextStatus)) {
      return NextResponse.json(
        { error: 'Status must be draft or confirmed' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    const existingRes = await client.query(
      `SELECT * FROM sales_orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [orderId, tenant.businessId]
    );
    if (existingRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Sales order not found' }, { status: 404 });
    }

    const existing = existingRes.rows[0];
    if (!isSalesOrderEditable(existing)) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: 'This sales order can no longer be edited',
          code: 'SALES_ORDER_NOT_EDITABLE',
        },
        { status: 400 }
      );
    }

    const hasBranchId = await hasTableColumn('sales_orders', 'branch_id');
    const branchId = hasBranchId ? (existing.branch_id as string | null) : null;

    try {
      await authorize(userId, 'sales_orders', 'update', {
        branchId: branchId ?? undefined,
        businessId: tenant.businessId,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const updateRes = await client.query(
      `UPDATE sales_orders SET
         customer_id = $1,
         order_number = $2,
         order_date = $3,
         expected_delivery_date = $4,
         status = $5,
         subtotal = $6,
         discount_total = $7,
         tax_total = $8,
         round_off = $9,
         grand_total = $10,
         additional_charges = $11,
         additional_charges_label = $12,
         shipping_address = $13,
         billing_address = $14,
         place_of_supply_state_code = $15,
         notes = $16,
         terms = $17,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $18 AND business_id = $19
       RETURNING *`,
      [
        customer_id,
        order_number,
        order_date,
        expected_delivery_date || null,
        nextStatus,
        subtotal,
        discount_total,
        tax_total,
        round_off,
        grand_total,
        additional_charges,
        additional_charges_label || null,
        shipping_address || null,
        billing_address || null,
        place_of_supply_state_code || null,
        notes || null,
        terms || null,
        orderId,
        tenant.businessId,
      ]
    );

    await client.query(`DELETE FROM sales_order_items WHERE sales_order_id = $1`, [orderId]);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await client.query(
        `INSERT INTO sales_order_items (
          sales_order_id, item_id, item_name, description, hsn_sac, qty, unit, unit_price,
          discount_percent, discount_amount, tax_rate, tax_amount, taxable_value,
          cgst_amount, sgst_amount, igst_amount, line_total, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          orderId,
          item.item_id || null,
          item.item_name || item.name,
          item.description || null,
          item.hsn_sac || null,
          item.qty || item.quantity,
          item.unit || 'PCS',
          item.unit_price || item.price,
          item.discount_percent || 0,
          item.discount_amount || 0,
          item.tax_rate || item.taxPercent || 0,
          item.tax_amount || 0,
          item.taxable_value || 0,
          item.cgst_amount || 0,
          item.sgst_amount || 0,
          item.igst_amount || 0,
          item.line_total || item.total || 0,
          i,
        ]
      );
    }

    await client.query('COMMIT');

    const salesOrder = updateRes.rows[0];
    const itemsResult = await pool.query(
      `SELECT * FROM sales_order_items WHERE sales_order_id = $1 ORDER BY sort_order, id`,
      [orderId]
    );
    salesOrder.items = itemsResult.rows;
    salesOrder.editable = isSalesOrderEditable(salesOrder);

    return NextResponse.json({ salesOrder });
  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[sales-orders/[id] PUT]', error);
    return NextResponse.json(
      {
        error: 'Failed to update sales order',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
