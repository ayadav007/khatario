import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { resolveBranchId } from '@/lib/branch-helpers';
import { assertItemBelongsToBusiness, ItemOwnershipError } from '@/lib/item-ownership';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import {
  createPurchaseInTransaction,
  PurchaseCreateServiceError,
} from '@/lib/purchases/purchase-create-service';
import { todayIsoDate } from '@/lib/invoices/convert-to-invoice';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchase-orders/[id]/convert
 * Converts a purchase order into a final purchase bill through the shared purchase
 * service, so stock, GST, ledger and supplier balance are posted together.
 * Body (optional): { bill_number, bill_date }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const actorUserId = getUserIdFromRequest(request);
  if (!actorUserId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const pool = getPool();
  const client = await pool.connect();

  try {
    const purchaseOrderId = params.id;
    await client.query('BEGIN');

    const orderRes = await client.query(
      `SELECT po.*, s.state_code AS supplier_state_code, s.gstin AS supplier_gstin
         FROM purchase_orders po
         LEFT JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.id = $1
        FOR UPDATE OF po`,
      [purchaseOrderId]
    );
    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
    }
    const purchaseOrder = orderRes.rows[0];

    if (purchaseOrder.converted_purchase_id) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Purchase order already converted', purchase_id: purchaseOrder.converted_purchase_id },
        { status: 400 }
      );
    }
    if (purchaseOrder.status === 'cancelled') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Cancelled purchase orders cannot be converted' }, { status: 400 });
    }

    const itemsRes = await client.query(
      `SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY sort_order ASC`,
      [purchaseOrderId]
    );
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
          { error: `Cannot convert purchase order: ${msg}`, code: 'ITEM_BUSINESS_MISMATCH' },
          { status: 400 }
        );
      }
    }

    let branchId: string;
    try {
      branchId = await resolveBranchId({ businessId: purchaseOrder.business_id, branchId: null });
    } catch (e: any) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: e?.message || 'Could not resolve branch for purchase' }, { status: 400 });
    }

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    let defaultWarehouseId: string | null = null;
    if (await isWarehouseModeEnabled(purchaseOrder.business_id)) {
      const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
      defaultWarehouseId = await getDefaultWarehouseForBranch(branchId);
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

    const billNumber =
      typeof body.bill_number === 'string' && body.bill_number.trim()
        ? body.bill_number.trim()
        : `BILL-${purchaseOrder.order_number}`;
    const billDate =
      typeof body.bill_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(body.bill_date)
        ? body.bill_date.slice(0, 10)
        : todayIsoDate();

    const result = await createPurchaseInTransaction(client, {
      business_id: purchaseOrder.business_id,
      created_by: actorUserId,
      branch_id: branchId,
      supplier_id: purchaseOrder.supplier_id,
      bill_number: billNumber,
      bill_date: billDate,
      status: 'final',
      notes: purchaseOrder.notes ?? null,
      place_of_supply_state_code: purchaseOrder.place_of_supply_state_code || null,
      supplier_state_code: purchaseOrder.supplier_state_code || null,
      supplier_gstin: purchaseOrder.supplier_gstin || null,
      round_off: Number(purchaseOrder.round_off) || 0,
      document_type: 'tax_invoice',
      itc_eligible: true,
      items: orderItems.map((oi: any) => ({
        item_id: oi.item_id || null,
        item_name: oi.item_name,
        hsn_sac: oi.hsn_sac,
        quantity: Number(oi.qty ?? oi.quantity) || 0,
        unit: oi.unit || 'PCS',
        unit_price: Number(oi.unit_price) || 0,
        discount_percent: Number(oi.discount_percent) || 0,
        discount_amount: Number(oi.discount_amount) || 0,
        tax_rate: Number(oi.tax_rate) || 0,
        tax_mode: 'exclusive',
        location_id: defaultWarehouseId,
      })),
    });

    await client.query(
      `UPDATE purchase_orders
          SET status = 'fulfilled', converted_purchase_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
      [result.purchase.id, purchaseOrderId]
    );

    await client.query('COMMIT');

    const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
    await logActivity({
      business_id: purchaseOrder.business_id,
      user_id: actorUserId,
      action_type: 'convert',
      module: 'purchase_orders',
      entity_id: purchaseOrderId,
      entity_type: 'purchase_order',
      description: `Converted to purchase ${billNumber}`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
      metadata: {
        purchase_id: result.purchase.id,
        bill_number: billNumber,
        order_number: purchaseOrder.order_number,
      },
    });

    return NextResponse.json(
      { purchase: result.purchase, purchase_order_id: purchaseOrderId },
      { status: 201 }
    );
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof PurchaseCreateServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...(error.details || {}) },
        { status: error.statusCode }
      );
    }
    console.error('Error converting purchase order:', error);
    return NextResponse.json(
      { error: 'Failed to convert purchase order', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
