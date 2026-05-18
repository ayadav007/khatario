import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { createInterBranchPurchaseEntries } from '@/lib/inter-branch-utils';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * POST /api/stock-transfers/[id]/receive
 * Receive/complete a stock transfer - adds stock to destination warehouse
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const { received_items, notes, received_by } = body;

    const userId = received_by || body.user_id; // REQUIRED for authorization
    if (!userId) {
      return NextResponse.json(
        { error: 'received_by (user_id) is required for authorization' },
        { status: 400 }
      );
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

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(transfer.business_id, 'multi_warehouse');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // AUTHORIZATION: Check receive permission (PBAC will check destination warehouse access, status='in_transit', period lock, stock freeze)
    // Note: Status validation is now handled by PBAC policy (transferCanBeReceived) - removed inline checks
    try {
      await authorize(userId, 'warehouse_transfer', 'receive', {
        businessId: transfer.business_id,
        resourceId: params.id,
        destinationWarehouseId: transfer.to_location_id,
        transfer_date: transfer.transfer_date,
        status: transfer.status,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await client.query('BEGIN');

    // Get transfer items
    const transferItemsResult = await client.query(`
      SELECT * FROM stock_transfer_items WHERE transfer_id = $1
    `, [params.id]);

    const transferItems = transferItemsResult.rows;

    // If received_items provided, use those; otherwise use all items as expected
    const itemsToReceive = received_items || transferItems.map(item => ({
      item_id: item.item_id,
      qty: item.qty,
      received_qty: item.qty // Default to expected quantity
    }));

    // Add stock to destination warehouse
    for (const receivedItem of itemsToReceive) {
      const transferItem = transferItems.find(ti => ti.item_id === receivedItem.item_id);
      if (!transferItem) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: `Item ${receivedItem.item_id} not found in transfer` },
          { status: 400 }
        );
      }

      const dispatchedQty = parseFloat(transferItem.quantity_dispatched || transferItem.qty || '0');
      const receivedQty = parseFloat(receivedItem.received_qty || receivedItem.qty || dispatchedQty);

      // Validate: Cannot receive more than dispatched
      if (receivedQty > dispatchedQty) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { 
            error: `Cannot receive more than dispatched. Dispatched: ${dispatchedQty}, Received: ${receivedQty}`,
            item_id: receivedItem.item_id
          },
          { status: 400 }
        );
      }

      // Lock destination location stock
      await client.query(`
        SELECT * FROM location_stock 
        WHERE location_id = $1 AND item_id = $2
        FOR UPDATE
      `, [transfer.to_location_id, receivedItem.item_id]);

      // Add stock to destination
      await client.query(`
        INSERT INTO location_stock (location_id, item_id, current_stock_qty)
        VALUES ($1, $2, $3)
        ON CONFLICT (location_id, item_id)
        DO UPDATE SET 
          current_stock_qty = location_stock.current_stock_qty + $3,
          last_updated = CURRENT_TIMESTAMP
      `, [transfer.to_location_id, receivedItem.item_id, receivedQty]);

      // Record stock movement for receiving
      await client.query(`
        INSERT INTO stock_movements (
          business_id, item_id, location_id, type, quantity,
          reference_type, reference_id, notes
        )
        VALUES ($1, $2, $3, 'in', $4, 'stock_transfer', $5, $6)
      `, [
        transfer.business_id,
        receivedItem.item_id,
        transfer.to_location_id,
        receivedQty,
        transfer.id,
        `Received transfer ${transfer.transfer_number}${receivedQty !== dispatchedQty ? ` (Expected: ${dispatchedQty}, Received: ${receivedQty})` : ''}`
      ]);

      // Update transfer item with received quantity
      const dispatchedQtyForUpdate = parseFloat(transferItem.quantity_dispatched || transferItem.qty || '0');
      await client.query(`
        UPDATE stock_transfer_items
        SET received_qty = $1, 
            notes = CASE 
              WHEN $2 IS NOT NULL AND $1 != $3 THEN COALESCE(notes || E'\n', '') || $2
              WHEN $2 IS NOT NULL THEN COALESCE(notes || E'\n', '') || $2
              ELSE notes
            END
        WHERE transfer_id = $4 AND item_id = $5
      `, [
        receivedQty,
        receivedQty !== dispatchedQtyForUpdate ? `Received: ${receivedQty}, Dispatched: ${dispatchedQtyForUpdate}` : null,
        dispatchedQtyForUpdate,
        transfer.id,
        receivedItem.item_id
      ]);
    }

    // Check if all items are fully received
    const allItemsReceived = await client.query(`
      SELECT 
        COUNT(*) as total_items,
        COUNT(CASE WHEN received_qty >= quantity_dispatched THEN 1 END) as fully_received_items
      FROM stock_transfer_items
      WHERE transfer_id = $1
    `, [params.id]);

    const totalItems = parseInt(allItemsReceived.rows[0]?.total_items || '0');
    const fullyReceivedItems = parseInt(allItemsReceived.rows[0]?.fully_received_items || '0');

    // Update transfer status: completed if all items fully received, otherwise stays in_transit (partial receipt)
    const finalStatus = (fullyReceivedItems === totalItems && totalItems > 0) ? 'completed' : 'in_transit';

    await client.query(`
      UPDATE stock_transfers 
      SET status = $1, 
          updated_at = CURRENT_TIMESTAMP,
          notes = CASE 
            WHEN $2 IS NOT NULL AND notes IS NOT NULL THEN notes || E'\n' || $2
            WHEN $2 IS NOT NULL THEN $2
            ELSE notes
          END
      WHERE id = $3
    `, [finalStatus, notes || null, params.id]);

    // If inter-branch transfer, create purchase entries for destination branch
    if (transfer.inter_branch_invoice_id) {
      try {
        const invoice = await queryOne(`
          SELECT id, invoice_number, invoice_date, grand_total, subtotal
          FROM invoices
          WHERE id = $1
        `, [transfer.inter_branch_invoice_id]);

        if (invoice) {
          // Get destination warehouse branch
          const toWarehouse = await queryOne(`
            SELECT branch_id FROM warehouses WHERE id = $1
          `, [transfer.to_location_id]);

          if (toWarehouse?.branch_id) {
            // Calculate inventory amount (COGS)
            let inventoryAmount = 0;
            for (const receivedItem of itemsToReceive) {
              if (receivedItem.item_id) {
                const itemData = await client.query(`
                  SELECT purchase_price, item_type FROM items WHERE id = $1
                `, [receivedItem.item_id]);
                
                if (itemData.rows[0]?.item_type === 'goods' && itemData.rows[0]?.purchase_price) {
                  const itemCost = Number(itemData.rows[0].purchase_price) || 0;
                  const quantity = Number(receivedItem.received_qty || receivedItem.qty || 0);
                  inventoryAmount += itemCost * quantity;
                }
              }
            }

            await createInterBranchPurchaseEntries({
              businessId: transfer.business_id,
              toBranchId: toWarehouse.branch_id,
              invoiceId: invoice.id,
              invoiceNumber: invoice.invoice_number,
              invoiceDate: invoice.invoice_date,
              grandTotal: invoice.grand_total,
              subtotal: invoice.subtotal,
              inventoryAmount: inventoryAmount,
            });
          }
        }
      } catch (accountingError) {
        console.error('Error creating inter-branch purchase entries:', accountingError);
        // Don't fail transfer receipt if accounting fails
      }
    }

    await client.query('COMMIT');

    // Fetch updated transfer with warehouse names
    const updatedTransfer = await queryOne(`
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
      transfer: updatedTransfer
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error receiving stock transfer:', error);
    return NextResponse.json(
      { error: 'Failed to receive stock transfer', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
