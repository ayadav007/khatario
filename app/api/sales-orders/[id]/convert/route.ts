import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { checkLimitInTransaction } from '@/lib/subscription';
import { resolveBranchId } from '@/lib/branch-helpers';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';

/**
 * POST /api/sales-orders/[id]/convert
 * Convert a sales order to an invoice
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    const salesOrderId = params.id;
    
    await client.query('BEGIN');

    // Fetch sales order with items
    const orderRes = await client.query(`
      SELECT 
        so.*,
        c.state as customer_state,
        c.state_code as customer_state_code
      FROM sales_orders so
      LEFT JOIN customers c ON so.customer_id = c.id
      WHERE so.id = $1
    `, [salesOrderId]);

    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Sales order not found' }, { status: 404 });
    }

    const salesOrder = orderRes.rows[0];

    let invoiceBranchId: string;
    try {
      invoiceBranchId = await resolveBranchId({ businessId: salesOrder.business_id, branchId: null });
    } catch (e: any) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: e?.message || 'Could not resolve branch for invoice' },
        { status: 400 }
      );
    }

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(salesOrder.business_id);
    let defaultWarehouseId: string | null = null;
    if (warehouseModeEnabled) {
      const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
      defaultWarehouseId = await getDefaultWarehouseForBranch(invoiceBranchId);
      if (!defaultWarehouseId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error:
              'Warehouse mode is enabled but no default warehouse is configured for this branch. Configure a default warehouse before converting sales orders.',
            code: 'WAREHOUSE_REQUIRED',
          },
          { status: 400 }
        );
      }
    }

    if (salesOrder.converted_invoice_id) {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json({ 
        error: 'Sales order already converted',
        invoice_id: salesOrder.converted_invoice_id 
      }, { status: 400 });
    }

    // CRITICAL: Check subscription limit INSIDE transaction with locking
    // This prevents bypassing limits by creating sales orders then converting them
    const limitCheck = await checkLimitInTransaction(client, salesOrder.business_id, 'invoices');
    
    if (!limitCheck.allowed) {
      // Subscription limit exceeded - rollback transaction
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { 
          error: limitCheck.message || 'Invoice limit reached. Cannot convert sales order to invoice.',
          limit: limitCheck.limit,
          current: limitCheck.current,
          code: 'SUBSCRIPTION_LIMIT_EXCEEDED'
        },
        { status: 403 }
      );
    }

    // Limit check passed - proceed with conversion

    // Fetch sales order items
    const itemsRes = await client.query(`
      SELECT * FROM sales_order_items
      WHERE sales_order_id = $1
      ORDER BY sort_order ASC
    `, [salesOrderId]);

    const orderItems = itemsRes.rows;

    if (orderItems.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Sales order has no items' }, { status: 400 });
    }

    // Get business info for invoice number and state
    const businessRes = await client.query(`
      SELECT invoice_prefix, next_invoice_number, state_code, state
      FROM businesses
      WHERE id = $1
    `, [salesOrder.business_id]);

    if (businessRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const business = businessRes.rows[0];

    // Generate invoice number
    const invoiceNumber = `${business.invoice_prefix}-${String(business.next_invoice_number).padStart(3, '0')}`;

    // Determine place of supply state code
    const businessStateCode = business.state_code || '';
    const customerStateCode = salesOrder.customer_state_code || '';
    const placeOfSupplyStateCode = salesOrder.place_of_supply_state_code || customerStateCode || businessStateCode;

    // Determine supply type (simplified logic)
    let supplyType = 'b2c_small';
    if (salesOrder.customer_id) {
      // Check if customer has GSTIN (B2B)
      const customerGstinRes = await client.query(
        'SELECT gstin FROM customers WHERE id = $1',
        [salesOrder.customer_id]
      );
      if (customerGstinRes.rows.length > 0 && customerGstinRes.rows[0].gstin) {
        supplyType = 'b2b';
      } else if (salesOrder.grand_total > 250000) {
        supplyType = 'b2c_large';
      }
    }

    // Create invoice
    const invoiceRes = await client.query(`
      INSERT INTO invoices (
        business_id, branch_id, customer_id, invoice_number, invoice_date,
        status, payment_status, subtotal, discount_total, tax_total,
        grand_total, billing_address, shipping_address, place_of_supply_state_code,
        cgst_total, sgst_total, igst_total, document_type, supply_type, notes, terms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *
    `, [
      salesOrder.business_id,
      invoiceBranchId,
      salesOrder.customer_id,
      invoiceNumber,
      salesOrder.order_date,
      'final', // Converted orders are immediately finalized
      'unpaid',
      salesOrder.subtotal,
      salesOrder.discount_total,
      salesOrder.tax_total,
      salesOrder.grand_total,
      salesOrder.billing_address,
      salesOrder.shipping_address,
      placeOfSupplyStateCode,
      // Calculate CGST/SGST/IGST totals from items (simplified - sum from items)
      orderItems.reduce((sum, item) => sum + Number(item.cgst_amount || 0), 0),
      orderItems.reduce((sum, item) => sum + Number(item.sgst_amount || 0), 0),
      orderItems.reduce((sum, item) => sum + Number(item.igst_amount || 0), 0),
      'tax_invoice',
      supplyType,
      salesOrder.notes,
      salesOrder.terms
    ]);

    const invoice = invoiceRes.rows[0];

    // Create invoice items and update stock
    for (const orderItem of orderItems) {
      const locationId = warehouseModeEnabled ? defaultWarehouseId : null;
      await client.query(`
        INSERT INTO invoice_items (
          invoice_id, item_id, item_name, description, hsn_sac,
          quantity, unit, unit_price, discount_percent, discount_amount,
          tax_rate, tax_amount, taxable_value, cgst_amount, sgst_amount, igst_amount,
          line_total, sort_order, location_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `, [
        invoice.id,
        orderItem.item_id,
        orderItem.item_name,
        orderItem.description,
        orderItem.hsn_sac,
        orderItem.qty,
        orderItem.unit,
        orderItem.unit_price,
        orderItem.discount_percent || 0,
        orderItem.discount_amount || 0,
        orderItem.tax_rate || 0,
        orderItem.tax_amount || 0,
        orderItem.taxable_value || 0,
        orderItem.cgst_amount || 0,
        orderItem.sgst_amount || 0,
        orderItem.igst_amount || 0,
        orderItem.line_total,
        orderItem.sort_order,
        locationId,
      ]);

      if (orderItem.item_id) {
        const itemTypeRes = await client.query('SELECT item_type FROM items WHERE id = $1', [orderItem.item_id]);
        const itemType = itemTypeRes.rows[0]?.item_type || 'goods';

        if (itemType === 'goods') {
          const qty = Number(orderItem.qty) || 0;
          if (warehouseModeEnabled && defaultWarehouseId) {
            await client.query(
              `
              INSERT INTO location_stock (location_id, item_id, current_stock_qty)
              VALUES ($1, $2, 0)
              ON CONFLICT (location_id, item_id) DO NOTHING
            `,
              [defaultWarehouseId, orderItem.item_id]
            );
            await client.query(
              `SELECT 1 FROM location_stock WHERE location_id = $1 AND item_id = $2 FOR UPDATE`,
              [defaultWarehouseId, orderItem.item_id]
            );
            await client.query(
              `
              UPDATE location_stock
              SET current_stock_qty = current_stock_qty - $1,
                  last_updated = CURRENT_TIMESTAMP
              WHERE location_id = $2 AND item_id = $3
            `,
              [qty, defaultWarehouseId, orderItem.item_id]
            );
          } else {
            await adjustBranchItemStock(client, salesOrder.business_id, invoiceBranchId, orderItem.item_id, -qty);
            await refreshItemGlobalStockFromBranches(client, salesOrder.business_id, orderItem.item_id);
          }

          await client.query(
            `
            INSERT INTO stock_movements (
              business_id, item_id, type, quantity, reference_type, reference_id, location_id
            )
            VALUES ($1, $2, 'out', $3, 'invoice', $4, $5)
          `,
            [salesOrder.business_id, orderItem.item_id, qty, invoice.id, locationId]
          );
        }
      }
    }

    // Update sales order status and link to invoice
    await client.query(`
      UPDATE sales_orders
      SET status = 'fulfilled',
          converted_invoice_id = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [invoice.id, salesOrderId]);

    // Increment next invoice number
    await client.query(`
      UPDATE businesses
      SET next_invoice_number = next_invoice_number + 1
      WHERE id = $1
    `, [salesOrder.business_id]);

    // Update customer receivables
    await client.query(`
      UPDATE customers
      SET total_receivable = COALESCE(total_receivable, 0) + $1
      WHERE id = $2
    `, [salesOrder.grand_total, salesOrder.customer_id]);

    await client.query('COMMIT');

    return NextResponse.json({ 
      invoice,
      sales_order_id: salesOrderId
    }, { status: 201 });

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error converting sales order:', error);
    return NextResponse.json(
      { error: 'Failed to convert sales order', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

