import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { FeatureKeys } from '@/lib/featureKeys';
import { resolveBranchId } from '@/lib/branch-helpers';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { assertItemBelongsToBusiness, ItemOwnershipError } from '@/lib/item-ownership';
import { getUserIdFromRequest } from '@/lib/auth-helpers';

/**
 * POST /api/purchase-orders/[id]/convert
 * Convert a purchase order to a purchase
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    const purchaseOrderId = params.id;
    
    await client.query('BEGIN');

    // Fetch purchase order with items
    const orderRes = await client.query(`
      SELECT 
        po.*,
        s.state as supplier_state,
        s.state_code as supplier_state_code,
        s.gstin as supplier_gstin
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.id = $1
    `, [purchaseOrderId]);

    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
    }

    const purchaseOrder = orderRes.rows[0];

    const actorUserId = getUserIdFromRequest(request);
    if (!actorUserId) {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    try {
      await enforceAccess({
        businessId: purchaseOrder.business_id,
        userId: actorUserId,
        feature: FeatureKeys.PURCHASE_MANAGEMENT,
        limitType: 'purchases',
        poolClient: client,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      client.release();
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }

    if (purchaseOrder.converted_purchase_id) {
      await client.query('ROLLBACK');
      return NextResponse.json({ 
        error: 'Purchase order already converted',
        purchase_id: purchaseOrder.converted_purchase_id 
      }, { status: 400 });
    }

    // Fetch purchase order items
    const itemsRes = await client.query(`
      SELECT * FROM purchase_order_items
      WHERE purchase_order_id = $1
      ORDER BY sort_order ASC
    `, [purchaseOrderId]);

    const orderItems = itemsRes.rows;

    if (orderItems.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Purchase order has no items' }, { status: 400 });
    }

    for (const orderItem of orderItems) {
      if (!orderItem.item_id) continue;
      try {
        await assertItemBelongsToBusiness(client, orderItem.item_id, purchaseOrder.business_id);
      } catch (e) {
        await client.query('ROLLBACK');
        const msg = e instanceof ItemOwnershipError ? e.message : String(e);
        return NextResponse.json(
          {
            error: `Cannot convert purchase order: ${msg}`,
            code: 'ITEM_BUSINESS_MISMATCH',
          },
          { status: 400 }
        );
      }
    }

    let purchaseBranchId: string;
    try {
      purchaseBranchId = await resolveBranchId({ businessId: purchaseOrder.business_id, branchId: null });
    } catch (e: any) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: e?.message || 'Could not resolve branch for purchase' },
        { status: 400 }
      );
    }

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(purchaseOrder.business_id);
    let defaultWarehouseId: string | null = null;
    if (warehouseModeEnabled) {
      const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
      defaultWarehouseId = await getDefaultWarehouseForBranch(purchaseBranchId);
      if (!defaultWarehouseId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error:
              'Warehouse mode is enabled but no default warehouse is configured for this branch. Configure a default warehouse before converting purchase orders.',
            code: 'WAREHOUSE_REQUIRED',
          },
          { status: 400 }
        );
      }
    }

    // Get business info for bill number
    const businessRes = await client.query(`
      SELECT state_code, state
      FROM businesses
      WHERE id = $1
    `, [purchaseOrder.business_id]);

    if (businessRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const business = businessRes.rows[0];

    // Generate bill number (use order number as base or create new)
    const billNumber = `BILL-${purchaseOrder.order_number}`;

    // Determine place of supply state code
    const businessStateCode = business.state_code || '';
    const supplierStateCode = purchaseOrder.supplier_state_code || '';
    const placeOfSupplyStateCode = purchaseOrder.place_of_supply_state_code || supplierStateCode || businessStateCode;

    // Calculate tax totals from items
    const cgstTotal = orderItems.reduce((sum, item) => sum + Number(item.cgst_amount || 0), 0);
    const sgstTotal = orderItems.reduce((sum, item) => sum + Number(item.sgst_amount || 0), 0);
    const igstTotal = orderItems.reduce((sum, item) => sum + Number(item.igst_amount || 0), 0);
    const taxTotal = cgstTotal + sgstTotal + igstTotal;

    // Create purchase (header has no discount_total — discounts live on purchase_items)
    const grandTotal = Number(purchaseOrder.grand_total ?? 0);
    const balanceAmount = grandTotal;
    const paymentStatus = 'unpaid';

    const purchaseRes = await client.query(`
      INSERT INTO purchases (
        business_id, branch_id, supplier_id, bill_number, bill_date,
        status, subtotal, tax_total, round_off,
        grand_total, place_of_supply_state_code, supplier_gstin,
        cgst_total, sgst_total, igst_total, document_type,
        itc_eligible, notes, paid_amount, balance_amount, payment_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *
    `, [
      purchaseOrder.business_id,
      purchaseBranchId,
      purchaseOrder.supplier_id,
      billNumber,
      purchaseOrder.order_date,
      'final', // Converted orders are immediately finalized
      purchaseOrder.subtotal,
      taxTotal,
      purchaseOrder.round_off || 0,
      grandTotal,
      placeOfSupplyStateCode,
      purchaseOrder.supplier_gstin || null,
      cgstTotal,
      sgstTotal,
      igstTotal,
      'tax_invoice',
      true, // Default ITC eligible
      purchaseOrder.notes,
      0,
      balanceAmount,
      paymentStatus,
    ]);

    const purchase = purchaseRes.rows[0];

    // Create purchase items and update stock
    for (const orderItem of orderItems) {
      const locationId = warehouseModeEnabled ? defaultWarehouseId : null;
      await client.query(`
        INSERT INTO purchase_items (
          purchase_id, item_id, item_name, hsn_sac,
          quantity, unit, unit_price, discount_percent, discount_amount,
          tax_rate, tax_mode, tax_amount, taxable_value,
          cgst_amount, sgst_amount, igst_amount, line_total, location_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `, [
        purchase.id,
        orderItem.item_id,
        orderItem.item_name,
        orderItem.hsn_sac,
        orderItem.qty,
        orderItem.unit || 'PCS',
        orderItem.unit_price,
        orderItem.discount_percent || 0,
        orderItem.discount_amount || 0,
        orderItem.tax_rate || 0,
        'exclusive',
        orderItem.tax_amount || 0,
        orderItem.taxable_value || 0,
        orderItem.cgst_amount || 0,
        orderItem.sgst_amount || 0,
        orderItem.igst_amount || 0,
        orderItem.line_total,
        locationId,
      ]);

      if (orderItem.item_id) {
        const itemTypeRes = await client.query(
          'SELECT item_type FROM items WHERE id = $1 AND business_id = $2',
          [orderItem.item_id, purchaseOrder.business_id]
        );
        const itemType = itemTypeRes.rows[0]?.item_type || 'goods';

        if (itemType === 'goods') {
          const qty = Number(orderItem.qty) || 0;
          if (warehouseModeEnabled && defaultWarehouseId) {
            await client.query(
              `
              INSERT INTO location_stock (location_id, item_id, current_stock_qty)
              VALUES ($1, $2, $3)
              ON CONFLICT (location_id, item_id)
              DO UPDATE SET
                current_stock_qty = location_stock.current_stock_qty + $3,
                last_updated = CURRENT_TIMESTAMP
            `,
              [defaultWarehouseId, orderItem.item_id, qty]
            );
          } else {
            await adjustBranchItemStock(client, purchaseOrder.business_id, purchaseBranchId, orderItem.item_id, qty);
            await refreshItemGlobalStockFromBranches(client, purchaseOrder.business_id, orderItem.item_id);
          }

          await client.query(
            `
            INSERT INTO stock_movements (
              business_id, item_id, type, quantity, reference_type, reference_id, location_id
            )
            VALUES ($1, $2, 'in', $3, 'purchase', $4, $5)
          `,
            [purchaseOrder.business_id, orderItem.item_id, qty, purchase.id, locationId]
          );
        }
      }
    }

    // Update purchase order status and link to purchase
    await client.query(`
      UPDATE purchase_orders
      SET status = 'fulfilled',
          converted_purchase_id = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [purchase.id, purchaseOrderId]);

    // Update supplier balance (same as POST /api/purchases)
    if (purchaseOrder.supplier_id) {
      await client.query(
        `
        UPDATE suppliers
        SET current_balance = current_balance + $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
        [balanceAmount, purchaseOrder.supplier_id]
      );
    }

    await client.query('COMMIT');

    const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
    const userId = getUserIdFromRequest(request);
    await logActivity({
      business_id: purchaseOrder.business_id,
      user_id: userId || undefined,
      action_type: 'convert',
      module: 'purchase_orders',
      entity_id: purchaseOrderId,
      entity_type: 'purchase_order',
      description: `Converted to purchase ${billNumber}`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
      metadata: {
        purchase_id: purchase.id,
        bill_number: billNumber,
        order_number: purchaseOrder.order_number,
      },
    });

    return NextResponse.json({ 
      purchase,
      purchase_order_id: purchaseOrderId
    }, { status: 201 });

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error converting purchase order:', error);
    return NextResponse.json(
      { error: 'Failed to convert purchase order', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

