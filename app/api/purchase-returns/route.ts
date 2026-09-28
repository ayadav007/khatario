export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { createPurchaseReturnLedgerEntries } from '@/lib/ledger-utils';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { resolveBranchId } from '@/lib/branch-helpers';
import {
  buildReturnLinesFromBill,
  buildStandaloneReturnLines,
  purchaseReturnLineKey,
  PurchaseReturnValidationError,
} from '@/lib/purchases/purchase-return-lines';
import { movePurchaseReturnStock } from '@/lib/purchases/purchase-return-stock';
import {
  getBusinessIdFromRequest,
  getUserIdFromRequest,
  resolveCreatedByUserId,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/purchase-returns
 * Fetch all purchase returns for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

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
  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Invalid JSON body', 400);

  const business_id = getBusinessIdFromRequest(request, body);
  const { purchase_id, return_number, return_date, original_purchase_date, reason, items, notes } = body;
  const refund_status = body.refund_status || 'pending';
  const refund_mode = body.refund_mode || null;
  const refund_date = body.refund_date || null;
  const createdByUserId = getUserIdFromRequest(request, body) ?? resolveCreatedByUserId(request, body);

  if (!business_id || !return_number || !return_date || !Array.isArray(items) || items.length === 0) {
    return jsonError('business_id, return_number, return_date, and items are required', 400);
  }
  if (!createdByUserId) {
    return jsonError('created_by (user_id) is required. Sign in again if this persists.', 400);
  }

  try {
    await assertFeatureAccess(business_id, 'credit_notes');
    await assertFeatureAccess(business_id, 'purchase_management');
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
    throw error;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    const userRow = await client.query(`SELECT id FROM users WHERE id = $1 AND business_id = $2`, [
      createdByUserId,
      business_id,
    ]);
    if (userRow.rows.length === 0) {
      return jsonError('Invalid created_by: user not found for this business.', 400, 'INVALID_CREATED_BY');
    }

    await client.query('BEGIN');

    let bill: any = null;
    if (purchase_id) {
      const pb = await client.query(
        `SELECT id, branch_id, supplier_id, status, bill_date, place_of_supply_state_code, supplier_state_code
           FROM purchases
          WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
          FOR UPDATE`,
        [purchase_id, business_id]
      );
      bill = pb.rows[0] ?? null;
      if (!bill) {
        await client.query('ROLLBACK');
        return jsonError('Original purchase bill not found', 404, 'PURCHASE_NOT_FOUND');
      }
      if (bill.status !== 'final') {
        await client.query('ROLLBACK');
        return jsonError('Returns can only be recorded against a final purchase bill', 400, 'PURCHASE_NOT_FINAL');
      }
    }
    const supplier_id: string | null = body.supplier_id || bill?.supplier_id || null;
    if (bill && body.supplier_id && bill.supplier_id && body.supplier_id !== bill.supplier_id) {
      await client.query('ROLLBACK');
      return jsonError('Supplier does not match the original bill', 400, 'SUPPLIER_MISMATCH');
    }

    let stockBranchId: string;
    try {
      stockBranchId = await resolveBranchId({ businessId: business_id, branchId: bill?.branch_id ?? null });
    } catch (e: any) {
      await client.query('ROLLBACK');
      return jsonError(e?.message || 'Could not resolve branch for purchase return', 400);
    }

    try {
      await authorize(createdByUserId, 'purchases', 'create', { branchId: stockBranchId });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    let defaultWarehouseId: string | null = null;
    if (await isWarehouseModeEnabled(business_id)) {
      const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
      defaultWarehouseId = await getDefaultWarehouseForBranch(stockBranchId);
      if (!defaultWarehouseId) {
        await client.query('ROLLBACK');
        return jsonError(
          'Warehouse mode is enabled but no default warehouse is configured for this branch. Configure a default warehouse before recording purchase returns that affect stock.',
          400,
          'WAREHOUSE_REQUIRED'
        );
      }
    }

    const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
    try {
      await assertGstPeriodNotFiledForDocumentDate(business_id, stockBranchId, return_date, 'save purchase return');
    } catch (error: any) {
      await client.query('ROLLBACK');
      return jsonError(error.message || 'GST period is filed', 403, 'GST_PERIOD_FILED');
    }
    const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
    try {
      await assertPeriodNotLocked(business_id, stockBranchId, return_date, 'purchase return');
    } catch (error: any) {
      await client.query('ROLLBACK');
      return jsonError(error.message || 'Period is locked', 403, 'PERIOD_LOCKED');
    }

    const businessRes = await client.query('SELECT state_code FROM businesses WHERE id = $1', [business_id]);
    const businessStateCode = String(businessRes.rows[0]?.state_code || '').slice(0, 2);
    let supplierStateCode = String(bill?.supplier_state_code || '').slice(0, 2);
    if (!supplierStateCode && supplier_id) {
      const s = await client.query('SELECT state_code, gstin FROM suppliers WHERE id = $1 AND business_id = $2', [
        supplier_id,
        business_id,
      ]);
      supplierStateCode = String(s.rows[0]?.state_code || s.rows[0]?.gstin || '').slice(0, 2);
    }
    const posStateCode = bill?.place_of_supply_state_code || body.place_of_supply_state_code || supplierStateCode || null;

    let computed: ReturnType<typeof buildReturnLinesFromBill>;
    try {
      if (bill) {
        const billLines = await client.query(
          `SELECT item_id, item_name, hsn_sac, unit, quantity::float8 AS quantity,
                  taxable_value::float8 AS taxable_value, tax_rate::float8 AS tax_rate,
                  COALESCE(igst_amount, 0)::float8 AS igst_amount
             FROM purchase_items WHERE purchase_id = $1`,
          [bill.id]
        );
        const returned = await client.query(
          `SELECT pri.item_id, pri.description, SUM(pri.qty)::float8 AS qty
             FROM purchase_return_items pri
             JOIN purchase_returns pr ON pr.id = pri.return_id
            WHERE pr.purchase_id = $1 AND pr.business_id = $2
              AND COALESCE(pr.status, 'final') <> 'cancelled'
            GROUP BY pri.item_id, pri.description`,
          [bill.id, business_id]
        );
        const alreadyReturned = new Map<string, number>();
        for (const r of returned.rows) {
          const k = purchaseReturnLineKey(r.item_id, r.description);
          alreadyReturned.set(k, (alreadyReturned.get(k) || 0) + Number(r.qty));
        }
        computed = buildReturnLinesFromBill({
          billLines: billLines.rows,
          requested: items,
          alreadyReturned,
          roundOff: Number(body.round_off) || 0,
        });
      } else {
        computed = buildStandaloneReturnLines({
          requested: items,
          interState: !!supplierStateCode && !!businessStateCode && supplierStateCode !== businessStateCode,
          roundOff: Number(body.round_off) || 0,
        });
      }
    } catch (e) {
      await client.query('ROLLBACK');
      if (e instanceof PurchaseReturnValidationError) return jsonError(e.message, 400, e.code, e.details);
      throw e;
    }
    const { lines, totals } = computed;

    const returnResult = await client.query(
      `INSERT INTO purchase_returns (
         business_id, branch_id, supplier_id, purchase_id, return_number, return_date,
         original_purchase_date, reason, place_of_supply_state_code,
         subtotal, discount_total, tax_total, cgst_total, sgst_total, igst_total,
         round_off, grand_total, refund_status, refund_mode, refund_date,
         itc_reversed, itc_reversal_date, notes, created_by, status
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,$13,$14,$15,$16,$17,$18,$19,true,$6,$20,$21,'final')
       RETURNING *`,
      [
        business_id,
        stockBranchId,
        supplier_id,
        purchase_id || null,
        return_number,
        return_date,
        original_purchase_date || bill?.bill_date || null,
        reason || null,
        posStateCode,
        totals.subtotal,
        totals.tax_total,
        totals.cgst_total,
        totals.sgst_total,
        totals.igst_total,
        Math.round((totals.grand_total - totals.subtotal - totals.tax_total) * 100) / 100,
        totals.grand_total,
        refund_status,
        refund_mode,
        refund_date,
        notes || null,
        createdByUserId,
      ]
    );
    const purchaseReturn = returnResult.rows[0];

    let inventoryAmount = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await client.query(
        `INSERT INTO purchase_return_items (
           return_id, item_id, description, hsn_sac, qty, unit, unit_price,
           discount_percent, discount_amount, taxable_value,
           tax_rate, tax_amount, cgst_amount, sgst_amount, igst_amount, line_total, sort_order
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          purchaseReturn.id,
          l.item_id,
          l.description,
          l.hsn_sac,
          l.qty,
          l.unit,
          l.unit_price,
          l.taxable_value,
          l.tax_rate,
          l.tax_amount,
          l.cgst_amount,
          l.sgst_amount,
          l.igst_amount,
          l.line_total,
          i,
        ]
      );
      if (l.item_id) {
        const t = await client.query(`SELECT item_type FROM items WHERE id = $1 AND business_id = $2`, [
          l.item_id,
          business_id,
        ]);
        if ((t.rows[0]?.item_type || 'goods') === 'goods') inventoryAmount += l.taxable_value;
        await movePurchaseReturnStock(client, {
          businessId: business_id,
          branchId: stockBranchId,
          warehouseId: defaultWarehouseId,
          itemId: l.item_id,
          qty: l.qty,
          direction: 'out',
          returnId: purchaseReturn.id,
          referenceType: 'purchase_return',
          notes: `Return to Supplier: ${return_number}`,
        });
      }
    }
    inventoryAmount = Math.round(inventoryAmount * 100) / 100;

    if (supplier_id) {
      await client.query(
        `UPDATE suppliers SET current_balance = current_balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [totals.grand_total, supplier_id]
      );
    }
    if (purchase_id) {
      await client.query(
        `UPDATE purchases SET balance_amount = balance_amount - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [totals.grand_total, purchase_id]
      );
    }

    await createPurchaseReturnLedgerEntries({
      businessId: business_id,
      purchaseReturnId: purchaseReturn.id,
      returnNumber: return_number,
      returnDate: return_date,
      grandTotal: totals.grand_total,
      supplierId: supplier_id,
      inventoryAmount,
      branchId: stockBranchId,
      taxableValue: totals.subtotal,
      cgstTotal: totals.cgst_total,
      sgstTotal: totals.sgst_total,
      igstTotal: totals.igst_total,
      poolClient: client,
    });

    await client.query('COMMIT');
    return NextResponse.json({ purchaseReturn }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating purchase return:', error);
    if (error?.code === '23505') {
      return jsonError('A purchase return with this number already exists', 409, 'DUPLICATE_RETURN_NUMBER');
    }
    return jsonError('Failed to create purchase return', 500, undefined, { details: error.message });
  } finally {
    client.release();
  }
}