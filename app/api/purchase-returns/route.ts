export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { LandedCostError } from '@/lib/inventory/landed-cost-application';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { createPurchaseReturnInTx } from '@/lib/purchases/create-purchase-return';
import { requireStrictSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/purchase-returns
 * Fetch all purchase returns for a business
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const businessId = session.businessId;
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;
    const search = searchParams.get('search') || '';

    const pool = getPool();
    
    // Build query with search
    let whereClause = 'WHERE pr.business_id = $1';
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (search) {
      whereClause += ` AND (pr.return_number ILIKE $${paramIndex} OR s.name ILIKE $${paramIndex} OR p.bill_number ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Get total count
    const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM purchase_returns pr
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
      LEFT JOIN purchases p ON pr.purchase_id = p.id
      ${whereClause}
    `, params);
    const total = parseInt(countResult.rows[0]?.total || '0');

    // Get paginated results
    const result = await pool.query(`
      SELECT 
        pr.*,
        s.name as supplier_name,
        s.phone as supplier_phone,
        s.gstin as supplier_gstin,
        p.bill_number as purchase_bill_number
      FROM purchase_returns pr
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
      LEFT JOIN purchases p ON pr.purchase_id = p.id
      ${whereClause}
      ORDER BY pr.return_date DESC, pr.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limit, offset]);

    return NextResponse.json({ 
      purchaseReturns: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching purchase returns:', error);
    return NextResponse.json(
      { error: 'Failed to fetch purchase returns', details: error.message },
      { status: 500 }
    );
  }
}


function jsonError(message: string, status: number, code?: string, details?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}), ...(details || {}) }, { status });
}

/**
 * POST /api/purchase-returns
 * Goods returned to a supplier. Quantities are capped at the bill's purchased minus already
 * returned quantity, and value and GST are recomputed on the server from the bill lines.
 */
export async function POST(request: NextRequest) {
  const session = await requireStrictSession(request);
  if (!session.ok) return session.response;
  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Invalid JSON body', 400);

  const business_id = session.businessId;
  const createdByUserId = session.userId;
  const { purchase_id, return_number, return_date, original_purchase_date, reason, items, notes } = body;
  const refund_status = body.refund_status || 'pending';
  const refund_mode = body.refund_mode || null;
  const refund_date = body.refund_date || null;

  if (!return_number || !return_date || !Array.isArray(items) || items.length === 0) {
    return jsonError('return_number, return_date, and items are required', 400);
  }

  try {
    await assertFeatureAccess(business_id, 'credit_notes');
    await assertFeatureAccess(business_id, 'purchase_management');
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
    throw error;
  }

  try {
    await authorize(createdByUserId, 'purchases', 'create', { businessId: business_id });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const pool = getPool();
  if (body.supplier_id) {
    const supplier = await pool.query(
      `SELECT id FROM suppliers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [body.supplier_id, business_id]
    );
    if (supplier.rows.length === 0) return jsonError('Supplier not found', 400, 'SUPPLIER_NOT_FOUND');
  }
  if (purchase_id) {
    const billOwner = await pool.query(
      `SELECT id FROM purchases WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [purchase_id, business_id]
    );
    if (billOwner.rows.length === 0) return jsonError('Original purchase bill not found', 404, 'PURCHASE_NOT_FOUND');
  }
  const requestedItemIds = (items as Array<{ item_id?: string | null }>)
    .map((item) => item.item_id)
    .filter((id): id is string => !!id);
  if (requestedItemIds.length > 0) {
    const ownedItems = await pool.query(
      `SELECT id FROM items WHERE business_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
      [business_id, requestedItemIds]
    );
    if (ownedItems.rows.length !== new Set(requestedItemIds).size) {
      return jsonError('Item not found', 400, 'ITEM_NOT_FOUND');
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await createPurchaseReturnInTx(client, {
      businessId: business_id,
      userId: createdByUserId,
      purchaseId: purchase_id || null,
      supplierId: body.supplier_id || null,
      returnNumber: return_number,
      returnDate: return_date,
      originalPurchaseDate: original_purchase_date || null,
      reason: reason || null,
      items,
      notes: notes || null,
      refundStatus: refund_status,
      refundMode: refund_mode,
      refundDate: refund_date,
      roundOff: Number(body.round_off) || 0,
      refundIncidentalCharges: body.refund_incidental_charges === true,
      placeOfSupplyStateCode: body.place_of_supply_state_code || null,
    });
    if (!result.ok) {
      await client.query('ROLLBACK');
      return jsonError(result.error, result.status, result.code, result.details);
    }
    const { purchaseReturn } = result;
    await client.query('COMMIT');
    // A return against a connected supplier's bill: tell the supplier so they issue the credit note.
    if (purchase_id && purchaseReturn?.id) {
      const { noticeBuyerDebitNote } = await import('@/lib/supplier-hub-money');
      await noticeBuyerDebitNote({
        buyerBusinessId: business_id,
        purchaseId: purchase_id,
        returnId: purchaseReturn.id,
        amount: Number(purchaseReturn.grand_total) || 0,
        returnDate: return_date ? String(return_date).slice(0, 10) : null,
        reason: typeof reason === 'string' ? reason : null,
      });
    }
    return NextResponse.json({ purchaseReturn }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('Error creating purchase return:', error);
    if (error instanceof LandedCostError) {
      return jsonError(error.message, 409, error.code);
    }
    if (error?.code === '23505') {
      return jsonError('A purchase return with this number already exists', 409, 'DUPLICATE_RETURN_NUMBER');
    }
    return jsonError('Failed to create purchase return', 500, undefined, { details: error.message });
  } finally {
    client.release();
  }
}