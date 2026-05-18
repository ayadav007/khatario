import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { checkLimitInTransaction } from '@/lib/subscription';
import { resolveBranchId } from '@/lib/branch-helpers';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';

/**
 * POST /api/estimates/[id]/convert
 * Convert estimate to invoice
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const estimateId = params.id;
    const body = await request.json();
    const { invoice_number, invoice_date, due_date, created_by } = body;

    await client.query('BEGIN');

    // Fetch estimate
    const estimateRes = await client.query(`
      SELECT * FROM estimates WHERE id = $1 FOR UPDATE
    `, [estimateId]);

    if (estimateRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Estimate not found' },
        { status: 404 }
      );
    }

    const estimate = estimateRes.rows[0];

    if (estimate.status === 'converted') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Estimate already converted to invoice' },
        { status: 400 }
      );
    }

    const limitCheck = await checkLimitInTransaction(client, estimate.business_id, 'invoices');
    if (!limitCheck.allowed) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: limitCheck.message || 'Invoice limit reached. Cannot convert estimate to invoice.',
          limit: limitCheck.limit,
          current: limitCheck.current,
          code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
        },
        { status: 403 }
      );
    }

    let invoiceBranchId: string;
    try {
      invoiceBranchId = await resolveBranchId({ businessId: estimate.business_id, branchId: null });
    } catch (e: any) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: e?.message || 'Could not resolve branch for invoice' },
        { status: 400 }
      );
    }

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(estimate.business_id);
    let defaultWarehouseId: string | null = null;
    if (warehouseModeEnabled) {
      const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
      defaultWarehouseId = await getDefaultWarehouseForBranch(invoiceBranchId);
      if (!defaultWarehouseId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error:
              'Warehouse mode is enabled but no default warehouse is configured for this branch.',
            code: 'WAREHOUSE_REQUIRED',
          },
          { status: 400 }
        );
      }
    }

    const businessRes = await client.query(
      `SELECT state_code FROM businesses WHERE id = $1`,
      [estimate.business_id]
    );
    const placeOfSupply = businessRes.rows[0]?.state_code || null;

    const estimateItemsRes = await client.query(
      `SELECT * FROM estimate_items WHERE estimate_id = $1 ORDER BY sort_order`,
      [estimateId]
    );
    const estimateItems = estimateItemsRes.rows;

    const invoiceRes = await client.query(
      `
      INSERT INTO invoices (
        business_id, branch_id, customer_id, invoice_number, invoice_date, due_date, status,
        payment_status, place_of_supply_state_code,
        subtotal, discount_total, tax_total, round_off, grand_total,
        additional_charges, additional_charges_label, notes, terms,
        paid_amount, balance_amount, created_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, 'final',
        'unpaid', $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15, $16,
        0, $12, $17
      )
      RETURNING *
    `,
      [
        estimate.business_id,
        invoiceBranchId,
        estimate.customer_id,
        invoice_number,
        invoice_date,
        due_date || null,
        placeOfSupply,
        estimate.subtotal,
        estimate.discount_total,
        estimate.tax_total,
        estimate.round_off,
        estimate.grand_total,
        estimate.additional_charges,
        estimate.additional_charges_label,
        estimate.notes,
        estimate.terms,
        created_by,
      ]
    );

    const invoice = invoiceRes.rows[0];

    for (let i = 0; i < estimateItems.length; i++) {
      const item = estimateItems[i];
      const lineName = (item.description || 'Line item').toString().slice(0, 255);
      const qty = Number(item.qty) || 0;
      const discountAmt = Number(item.discount) || 0;
      const locationId = warehouseModeEnabled ? defaultWarehouseId : null;

      await client.query(
        `
        INSERT INTO invoice_items (
          invoice_id, item_id, item_name, description, hsn_sac,
          quantity, unit, unit_price, discount_percent, discount_amount,
          tax_rate, tax_amount, taxable_value, cgst_amount, sgst_amount, igst_amount,
          line_total, sort_order, location_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `,
        [
          invoice.id,
          item.item_id,
          lineName,
          item.description,
          null,
          qty,
          item.unit || 'PCS',
          item.unit_price,
          0,
          discountAmt,
          item.tax_rate || 0,
          item.tax_amount || 0,
          Math.max(0, qty * Number(item.unit_price) - discountAmt),
          0,
          0,
          0,
          item.line_total,
          item.sort_order ?? i,
          locationId,
        ]
      );

      if (item.item_id) {
        const itemTypeRes = await client.query(`SELECT item_type FROM items WHERE id = $1`, [item.item_id]);
        const itemType = itemTypeRes.rows[0]?.item_type || 'goods';
        if (itemType === 'goods' && qty > 0) {
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
            await adjustBranchItemStock(client, estimate.business_id, invoiceBranchId, item.item_id, -qty);
            await refreshItemGlobalStockFromBranches(client, estimate.business_id, item.item_id);
          }

          await client.query(
            `
            INSERT INTO stock_movements (
              business_id, item_id, type, quantity, reference_type, reference_id, location_id
            )
            VALUES ($1, $2, 'out', $3, 'invoice', $4, $5)
          `,
            [estimate.business_id, item.item_id, qty, invoice.id, locationId]
          );
        }
      }
    }

    await client.query(
      `
      UPDATE estimates 
      SET status = 'converted', converted_invoice_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `,
      [invoice.id, estimateId]
    );

    await client.query(
      `
      UPDATE customers 
      SET total_receivable = COALESCE(total_receivable, 0) + $1 
      WHERE id = $2
    `,
      [estimate.grand_total, estimate.customer_id]
    );

    await client.query('COMMIT');

    return NextResponse.json({ invoice, estimate_id: estimateId });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error converting estimate to invoice:', error);
    return NextResponse.json(
      { error: 'Failed to convert estimate', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
