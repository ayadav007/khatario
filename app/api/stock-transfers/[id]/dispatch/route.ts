import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { ensureInterBranchInvoiceForTransfer, issueInterBranchShortCreditNote } from '@/lib/inter-branch-utils';
import { ensureTransferChallan } from '@/lib/stock-transfers/transfer-challan';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/stock-transfers/[id]/dispatch
 * Dispatch a stock transfer (change status from 'pending' to 'in_transit')
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const { dispatch_date, notes } = body;
    // Optional per-item quantities actually sent (default: everything requested). Less than
    // requested is allowed; the invoice or challan covers only what left the godown.
    const sendQty = new Map<string, number>(
      Array.isArray(body.items)
        ? body.items
            .filter((i: any) => i && typeof i.item_id === 'string')
            .map((i: any) => [i.item_id, Math.max(0, Number(i.qty ?? i.quantity) || 0)] as [string, number])
        : []
    );

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get transfer with lock
    const transferResult = await client.query(`
      SELECT * FROM stock_transfers WHERE id = $1 FOR UPDATE
    `, [params.id]);

    if (transferResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Transfer not found' },
        { status: 404 }
      );
    }

    const transfer = transferResult.rows[0];
    const tenant = requireTenantBusinessId(request, transfer.business_id);
    if (!tenant.ok || tenant.businessId !== transfer.business_id) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(transfer.business_id, 'multi_warehouse');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // AUTHORIZATION: Check dispatch permission (PBAC will check source warehouse access, status='pending', period lock, stock freeze)
    // Note: Status validation is now handled by PBAC policy (transferCanBeDispatched) - removed inline checks
    try {
      await authorize(userId, 'warehouse_transfer', 'dispatch', {
        businessId: transfer.business_id,
        resourceId: params.id,
        sourceWarehouseId: transfer.from_location_id,
        transfer_date: transfer.transfer_date,
        status: transfer.status,
        resource: transfer,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await client.query('BEGIN');

    const locked = await client.query(
      `SELECT status FROM stock_transfers WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [params.id, tenant.businessId]
    );
    if (locked.rows[0]?.status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Transfer is ${locked.rows[0]?.status ?? 'missing'}; only pending transfers can be dispatched.`, code: 'TRANSFER_STATE_CHANGED' },
        { status: 409 }
      );
    }

    // Get transfer items with lock
    const transferItemsResult = await client.query(`
      SELECT * FROM stock_transfer_items 
      WHERE transfer_id = $1
      FOR UPDATE
    `, [params.id]);

    const transferItems = transferItemsResult.rows;

    const qtyFor = (item: any) => {
      const requested = parseFloat(item.quantity_requested || item.qty || '0');
      return sendQty.has(item.item_id) ? Math.min(requested, sendQty.get(item.item_id)!) : requested;
    };
    if (!transferItems.some((item: any) => qtyFor(item) > 0)) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Enter a quantity to dispatch for at least one item.' }, { status: 400 });
    }

    // Validate stock availability and deduct stock from source warehouse
    for (const item of transferItems) {
      const requestedQty = qtyFor(item);
      if (requestedQty <= 0) {
        await client.query(
          `UPDATE stock_transfer_items SET quantity_dispatched = 0 WHERE transfer_id = $1 AND item_id = $2`,
          [params.id, item.item_id]
        );
        continue;
      }
      
      // Lock and check stock availability
      const stockCheck = await client.query(`
        SELECT current_stock_qty 
        FROM location_stock 
        WHERE location_id = $1 AND item_id = $2
        FOR UPDATE
      `, [transfer.from_location_id, item.item_id]);

      const availableStock = parseFloat(stockCheck.rows[0]?.current_stock_qty || '0');

      if (availableStock < requestedQty) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { 
            error: `Insufficient stock for item. Available: ${availableStock}, Requested: ${requestedQty}`,
            item_id: item.item_id
          },
          { status: 400 }
        );
      }

      // Deduct stock from source warehouse
      await client.query(`
        INSERT INTO location_stock (location_id, item_id, current_stock_qty)
        VALUES ($1, $2, -($3::numeric))
        ON CONFLICT (location_id, item_id)
        DO UPDATE SET 
          current_stock_qty = location_stock.current_stock_qty - $3::numeric,
          last_updated = CURRENT_TIMESTAMP
      `, [transfer.from_location_id, item.item_id, requestedQty]);

      // Update quantity_dispatched
      await client.query(`
        UPDATE stock_transfer_items
        SET quantity_dispatched = $1
        WHERE transfer_id = $2 AND item_id = $3
      `, [requestedQty, params.id, item.item_id]);

      // Record stock movement
      await client.query(`
        INSERT INTO stock_movements (
          business_id, item_id, location_id, type, quantity,
          reference_type, reference_id, notes, unit_cost
        )
        VALUES ($1, $2, $3, 'out', $4, 'stock_transfer', $5, $6, $7)
      `, [
        transfer.business_id,
        item.item_id,
        transfer.from_location_id,
        requestedQty,
        transfer.id,
        `Transfer ${transfer.transfer_number} dispatched to ${transfer.to_location_id}`,
        item.cost_snapshot || null
      ]);
    }

    // Update transfer status to 'in_transit'
    await client.query(`
      UPDATE stock_transfers 
      SET status = 'in_transit',
          updated_at = CURRENT_TIMESTAMP,
          notes = CASE 
            WHEN $1::text IS NOT NULL AND notes IS NOT NULL THEN notes || E'\n' || $1::text
            WHEN $1::text IS NOT NULL THEN $1::text
            ELSE notes
          END
      WHERE id = $2
    `, [notes || null, params.id]);

    // Documents are issued when the goods are removed (s.31(1)(a)), for what was dispatched:
    // a tax invoice between GSTINs, a delivery challan within one GSTIN.
    const docs = await client.query(`SELECT inter_branch_invoice_id, transfer_number FROM stock_transfers WHERE id = $1`, [params.id]);
    const existingInvoiceId: string | null = docs.rows[0]?.inter_branch_invoice_id ?? null;
    if (existingInvoiceId) {
      // Raised at approval under the old flow for the requested quantity: credit what was not sent.
      const unsent = transferItems
        .map((item: any) => ({ itemId: item.item_id, qty: parseFloat(item.quantity_requested || item.qty || '0') - qtyFor(item) }))
        .filter((l: { qty: number }) => l.qty > 0.0005);
      if (unsent.length > 0) {
        await issueInterBranchShortCreditNote(client, {
          businessId: transfer.business_id,
          invoiceId: existingInvoiceId,
          transferNumber: docs.rows[0].transfer_number,
          date: String(dispatch_date || new Date().toISOString()).slice(0, 10),
          lines: unsent,
          userId,
          reason: `Not dispatched on inter-branch transfer ${docs.rows[0].transfer_number}`,
        });
      }
    } else {
      await ensureInterBranchInvoiceForTransfer(client, params.id, {
        ewayBillNumber: body.eway_bill_number,
        ewayBillDate: body.eway_bill_date,
        createdBy: userId,
        invoiceDate: dispatch_date ? String(dispatch_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
      });
    }
    await ensureTransferChallan(client, params.id, { ewayBillNumber: body.eway_bill_number, createdBy: userId });

    await client.query('COMMIT');

    // Fetch updated transfer with warehouse names
    const finalTransfer = await queryOne(`
      SELECT 
        st.*,
        fw.name as from_warehouse_name,
        tw.name as to_warehouse_name,
        u.name as approved_by_name,
        creator.name as created_by_name
      FROM stock_transfers st
      LEFT JOIN warehouses fw ON st.from_location_id = fw.id
      LEFT JOIN warehouses tw ON st.to_location_id = tw.id
      LEFT JOIN users u ON st.approved_by = u.id
      LEFT JOIN users creator ON st.created_by = creator.id
      WHERE st.id = $1
    `, [params.id]);

    return NextResponse.json({ 
      success: true,
      transfer: finalTransfer
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error dispatching stock transfer:', error);
    return NextResponse.json(
      { error: 'Failed to dispatch stock transfer', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
