import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { FeatureKeys } from '@/lib/featureKeys';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';

/**
 * GET /api/sales-orders
 * Fetch all sales orders for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const status = searchParams.get('status');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'sales_orders', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get user's accessible branch IDs
    let accessibleBranchIds: string[] = [];
    let branchFilter = '';
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
      if (accessibleBranchIds.length > 0) {
        branchFilter = `AND so.branch_id = ANY($${accessibleBranchIds.length + 1}::uuid[])`;
      } else {
        // User has no branch access - return empty result
        return NextResponse.json({ salesOrders: [] });
      }
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      // Continue without branch filtering if error
    }

    const pool = getPool();
    let query = `
      SELECT
        so.*,
        c.name as customer_name,
        COALESCE(pay.paid_sum, 0)::text AS total_paid,
        GREATEST(
          0::numeric,
          COALESCE(so.grand_total, 0) - COALESCE(pay.paid_sum, 0)
        )::text AS payment_remaining
      FROM sales_orders so
      LEFT JOIN customers c ON so.customer_id = c.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          SUM(CASE WHEN pt.status = 'success' THEN pt.amount ELSE 0 END),
          0
        )::numeric AS paid_sum
        FROM payment_transactions pt
        WHERE pt.business_id = so.business_id
          AND pt.order_id = so.id
      ) pay ON true
      WHERE so.business_id = $1
        ${branchFilter}
    `;

    const params: any[] = [businessId];
    if (accessibleBranchIds.length > 0) {
      params.push(accessibleBranchIds);
    }

    if (status) {
      query += ` AND so.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY so.order_date DESC, so.created_at DESC`;

    const result = await pool.query(query, params);

    return NextResponse.json({ salesOrders: result.rows });
  } catch (error: any) {
    console.error('Error fetching sales orders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sales orders', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sales-orders
 * Create a new sales order
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const body = await request.json();
    const business_id = getBusinessIdFromRequest(request, body);
    const {
      branch_id, // MANDATORY: Branch (accounting entity) that created this sales order
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
      created_by,
      status = 'draft',
    } = body;

    if (!business_id || !customer_id || !order_number || !order_date || !items || items.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'business_id, customer_id, order_number, order_date, and items are required' },
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

    // AUTHORIZATION: Check create permission
    try {
      await authorize(created_by, 'sales_orders', 'create');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branch_id,
        businessId: business_id,
      });
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }
      throw error;
    }

    // AUTHORIZATION: Check create permission with branch context
    try {
      await authorize(created_by, 'sales_orders', 'create', { branchId: finalBranchId });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await enforceAccess({
        businessId: business_id,
        userId: created_by,
        branchId: finalBranchId,
        feature: FeatureKeys.SALES_ORDERS,
        limitType: 'sales_orders',
        poolClient: client,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }

    // Check if sales_orders table has branch_id column
    const hasBranchId = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'sales_orders' 
      AND column_name = 'branch_id'
      LIMIT 1
    `);

    // Create sales order
    let orderResult;
    if (hasBranchId.rows.length > 0) {
      // Table has branch_id column
      orderResult = await client.query(`
        INSERT INTO sales_orders (
          business_id, branch_id, customer_id, order_number, order_date, expected_delivery_date,
          status, subtotal, discount_total, tax_total, round_off, grand_total,
          additional_charges, additional_charges_label, shipping_address, billing_address,
          place_of_supply_state_code, notes, terms, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        RETURNING *
      `, [
        business_id, finalBranchId, customer_id, order_number, order_date, expected_delivery_date,
        status, subtotal, discount_total, tax_total, round_off, grand_total,
        additional_charges, additional_charges_label || null, shipping_address || null, billing_address || null,
        place_of_supply_state_code || null, notes || null, terms || null, created_by || null
      ]);
    } else {
      // Table doesn't have branch_id column yet (backward compatibility)
      orderResult = await client.query(`
        INSERT INTO sales_orders (
          business_id, customer_id, order_number, order_date, expected_delivery_date,
          status, subtotal, discount_total, tax_total, round_off, grand_total,
          additional_charges, additional_charges_label, shipping_address, billing_address,
          place_of_supply_state_code, notes, terms, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING *
      `, [
        business_id, customer_id, order_number, order_date, expected_delivery_date,
        status, subtotal, discount_total, tax_total, round_off, grand_total,
        additional_charges, additional_charges_label || null, shipping_address || null, billing_address || null,
        place_of_supply_state_code || null, notes || null, terms || null, created_by || null
      ]);
    }

    const salesOrder = orderResult.rows[0];

    // Create sales order items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await client.query(`
        INSERT INTO sales_order_items (
          sales_order_id, item_id, item_name, description, hsn_sac, qty, unit, unit_price,
          discount_percent, discount_amount, tax_rate, tax_amount, taxable_value,
          cgst_amount, sgst_amount, igst_amount, line_total, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `, [
        salesOrder.id, item.item_id || null, item.item_name || item.name, item.description || null,
        item.hsn_sac || null, item.qty || item.quantity, item.unit || 'PCS', item.unit_price || item.price,
        item.discount_percent || 0, item.discount_amount || 0, item.tax_rate || item.taxPercent || 0,
        item.tax_amount || 0, item.taxable_value || 0,
        item.cgst_amount || 0, item.sgst_amount || 0, item.igst_amount || 0,
        item.line_total || item.total || 0, i
      ]);
    }

    await client.query('COMMIT');

    return NextResponse.json({ salesOrder }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating sales order:', error);
    return NextResponse.json(
      { error: 'Failed to create sales order', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

