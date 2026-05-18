import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { createPurchaseReturnLedgerEntries } from '@/lib/ledger-utils';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { resolveBranchId } from '@/lib/branch-helpers';
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

/**
 * POST /api/purchase-returns
 * Create a new purchase return (goods returned to supplier)
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    const body = await request.json();
    const business_id = getBusinessIdFromRequest(request, body);
    const {
      supplier_id,
      purchase_id,
      return_number,
      return_date,
      original_purchase_date,
      reason,
      place_of_supply_state_code,
      items,
      subtotal,
      discount_total,
      tax_total,
      cgst_total,
      sgst_total,
      igst_total,
      round_off,
      grand_total,
      refund_status = 'pending',
      refund_mode,
      refund_date,
      notes,
    } = body;

    const sessionUserId = getUserIdFromRequest(request, body);
    const createdByUserId = sessionUserId ?? resolveCreatedByUserId(request, body);

    if (!business_id || !return_number || !return_date || !items || items.length === 0) {
      client.release();
      return NextResponse.json(
        { error: 'business_id, return_number, return_date, and items are required' },
        { status: 400 }
      );
    }

    if (!createdByUserId) {
      client.release();
      return NextResponse.json(
        { error: 'created_by (user_id) is required. Sign in again if this persists.' },
        { status: 400 }
      );
    }

    const userRow = await client.query(
      `SELECT id FROM users WHERE id = $1 AND business_id = $2`,
      [createdByUserId, business_id]
    );
    if (userRow.rows.length === 0) {
      client.release();
      return NextResponse.json(
        {
          error: 'Invalid created_by: user not found for this business.',
          code: 'INVALID_CREATED_BY',
        },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access (credit_notes feature for purchase returns)
    try {
      await assertFeatureAccess(business_id, 'credit_notes');
      // Also check purchase_management since this is related to purchases
      await assertFeatureAccess(business_id, 'purchase_management');
    } catch (error) {
      client.release();
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await client.query('BEGIN');

    let purchaseBranchId: string | null = null;
    if (purchase_id) {
      const pb = await client.query(`SELECT branch_id FROM purchases WHERE id = $1 AND business_id = $2`, [
        purchase_id,
        business_id,
      ]);
      purchaseBranchId = pb.rows[0]?.branch_id ?? null;
    }

    let stockBranchId: string;
    try {
      stockBranchId = await resolveBranchId({ businessId: business_id, branchId: purchaseBranchId });
    } catch (e: any) {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { error: e?.message || 'Could not resolve branch for purchase return' },
        { status: 400 }
      );
    }

    try {
      await authorize(createdByUserId, 'purchases', 'create', { branchId: stockBranchId });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);
    let defaultWarehouseId: string | null = null;
    if (warehouseModeEnabled) {
      const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
      defaultWarehouseId = await getDefaultWarehouseForBranch(stockBranchId);
      if (!defaultWarehouseId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error:
              'Warehouse mode is enabled but no default warehouse is configured for this branch. Configure a default warehouse before recording purchase returns that affect stock.',
            code: 'WAREHOUSE_REQUIRED',
          },
          { status: 400 }
        );
      }
    }

    const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
    try {
      await assertGstPeriodNotFiledForDocumentDate(business_id, stockBranchId, return_date, 'save purchase return');
    } catch (error: any) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: error.message || 'GST period is filed',
          code: 'GST_PERIOD_FILED',
        },
        { status: 403 }
      );
    }

    const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
    try {
      await assertPeriodNotLocked(business_id, stockBranchId, return_date, 'purchase return');
    } catch (error: any) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: error.message || 'Period is locked',
          code: 'PERIOD_LOCKED',
        },
        { status: 403 }
      );
    }

    // Get business state code for GST calculations
    const businessRes = await client.query(
      'SELECT state_code FROM businesses WHERE id = $1',
      [business_id]
    );
    
    if (businessRes.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error('Business not found');
    }
    
    const businessStateCode = businessRes.rows[0].state_code || '';

    // Calculate place of supply if not provided
    let finalPosStateCode = place_of_supply_state_code;
    if (!finalPosStateCode && supplier_id) {
      const supplierRes = await client.query(
        'SELECT state_code FROM suppliers WHERE id = $1',
        [supplier_id]
      );
      if (supplierRes.rows.length > 0) {
        finalPosStateCode = supplierRes.rows[0].state_code;
      }
    }

    // Create purchase return record
    const returnResult = await client.query(`
      INSERT INTO purchase_returns (
        business_id, branch_id, supplier_id, purchase_id, return_number, return_date,
        original_purchase_date, reason, place_of_supply_state_code,
        subtotal, discount_total, tax_total, cgst_total, sgst_total, igst_total,
        round_off, grand_total, refund_status, refund_mode, refund_date,
        itc_reversed, notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      RETURNING *
    `, [
      business_id,
      stockBranchId,
      supplier_id,
      purchase_id,
      return_number,
      return_date,
      original_purchase_date,
      reason,
      finalPosStateCode,
      subtotal,
      discount_total,
      tax_total,
      cgst_total,
      sgst_total,
      igst_total,
      round_off,
      grand_total,
      refund_status,
      refund_mode,
      refund_date,
      true, // itc_reversed - mark as true since we're reversing ITC
      notes,
      createdByUserId,
    ]);

    const purchaseReturn = returnResult.rows[0];

    // Insert purchase return items and reduce stock
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      await client.query(`
        INSERT INTO purchase_return_items (
          return_id, item_id, description, hsn_sac, qty, unit, unit_price,
          discount_percent, discount_amount, taxable_value,
          tax_rate, tax_amount, cgst_amount, sgst_amount, igst_amount,
          line_total, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `, [
        purchaseReturn.id,
        item.item_id || null,
        item.description || item.item_name,
        item.hsn_sac || null,
        item.qty || item.quantity,
        item.unit || 'PCS',
        item.unit_price,
        item.discount_percent || 0,
        item.discount_amount || 0,
        item.taxable_value || 0,
        item.tax_rate || 0,
        item.tax_amount || 0,
        item.cgst_amount || 0,
        item.sgst_amount || 0,
        item.igst_amount || 0,
        item.line_total,
        i
      ]);

      if (item.item_id) {
        const itemTypeRes = await client.query(`SELECT item_type FROM items WHERE id = $1`, [item.item_id]);
        const itemType = itemTypeRes.rows[0]?.item_type || 'goods';
        if (itemType === 'goods') {
          const qty = Number(item.qty || item.quantity) || 0;
          if (warehouseModeEnabled && defaultWarehouseId) {
            await client.query(
              `
              INSERT INTO location_stock (location_id, item_id, current_stock_qty)
              VALUES ($1, $2, 0)
              ON CONFLICT (location_id, item_id) DO NOTHING
            `,
              [defaultWarehouseId, item.item_id]
            );
            await client.query(
              `SELECT 1 FROM location_stock WHERE location_id = $1 AND item_id = $2 FOR UPDATE`,
              [defaultWarehouseId, item.item_id]
            );
            await client.query(
              `
              UPDATE location_stock
              SET current_stock_qty = current_stock_qty - $1,
                  last_updated = CURRENT_TIMESTAMP
              WHERE location_id = $2 AND item_id = $3
            `,
              [qty, defaultWarehouseId, item.item_id]
            );
          } else {
            await adjustBranchItemStock(client, business_id, stockBranchId, item.item_id, -qty);
            await refreshItemGlobalStockFromBranches(client, business_id, item.item_id);
          }

          await client.query(
            `
            INSERT INTO stock_movements (
              business_id, item_id, type, quantity, reference_type, reference_id, location_id, notes
            )
            VALUES ($1, $2, 'out', $3, 'purchase_return', $4, $5, $6)
          `,
            [
              business_id,
              item.item_id,
              qty,
              purchaseReturn.id,
              warehouseModeEnabled ? defaultWarehouseId : null,
              `Return to Supplier: ${return_number}`,
            ]
          );
        }
      }
    }

    // Update supplier balance (you owe them less now)
    if (supplier_id) {
      await client.query(`
        UPDATE suppliers
        SET current_balance = current_balance - $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [grand_total, supplier_id]);
    }

    // Update linked purchase balance if applicable
    if (purchase_id) {
      await client.query(`
        UPDATE purchases
        SET balance_amount = balance_amount - $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [grand_total, purchase_id]);
    }

    // Calculate inventory amount (total of goods items being returned)
    let totalInventoryAmount = 0;
    for (const item of items) {
      if (item.item_id) {
        const itemData = await client.query(
          'SELECT item_type, purchase_price FROM items WHERE id = $1',
          [item.item_id]
        );
        
        if (itemData.rows[0]?.item_type === 'goods') {
          const itemCost = Number(itemData.rows[0]?.purchase_price) || Number(item.unit_price) || 0;
          const itemQuantity = Number(item.qty || item.quantity) || 0;
          totalInventoryAmount += itemCost * itemQuantity;
        }
      }
    }

    // PHASE-5: ledger posting runs INSIDE the transaction on the same client
    // so the deferred validate_voucher_balance trigger sees all lines at COMMIT.
    await createPurchaseReturnLedgerEntries({
      businessId: business_id,
      purchaseReturnId: purchaseReturn.id,
      returnNumber: return_number,
      returnDate: return_date,
      grandTotal: grand_total,
      supplierId: supplier_id || null,
      inventoryAmount: totalInventoryAmount,
      branchId: stockBranchId,
      // PHASE-3: GST split. Reverses the original ITC (Cr Input GST). For RCM /
      // blocked-credit returns the caller should pass itcEligible/isReverseCharge
      // matching the source purchase — currently the schema doesn't carry those
      // on purchase_returns, so we default to "regular eligible" which is the
      // common case.
      taxableValue: subtotal,
      cgstTotal: cgst_total,
      sgstTotal: sgst_total,
      igstTotal: igst_total,
      poolClient: client,
    });

    await client.query('COMMIT');

    return NextResponse.json({ purchaseReturn }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating purchase return:', error);
    return NextResponse.json(
      { error: 'Failed to create purchase return', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

