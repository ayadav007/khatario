import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getStateCode } from '@/lib/gst-utils';
import { createDebitNoteLedgerEntries } from '@/lib/ledger-utils';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { enforceAccess, enforceAccessErrorResponse, isPrimaryAdminForBusiness } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { resolveBranchId } from '@/lib/branch-helpers';
import { deriveInvoicePaymentStatus } from '@/lib/invoice-payment-status';

/**
 * GET /api/debit-notes
 * Fetch all debit notes for a business
 */
export async function GET(request: NextRequest) {
  try {
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!business_id) {
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

    try {
      await authorize(userId, 'debit_notes', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      return NextResponse.json({ debitNotes: [] });
    }

    const isAdmin = await isPrimaryAdminForBusiness(userId, business_id).catch(() => false);

    const pool = getPool();
    
    let whereClause = 'WHERE dn.business_id = $1';
    const params: any[] = [business_id];
    let paramIndex = 2;

    if (!isAdmin) {
      if (accessibleBranchIds.length === 0) {
        return NextResponse.json({ debitNotes: [] });
      }
      whereClause += ` AND dn.branch_id = ANY($${paramIndex}::uuid[])`;
      params.push(accessibleBranchIds);
      paramIndex++;
    }

    const debitNotes = await pool.query(`
      SELECT 
        dn.*,
        c.name as customer_name,
        c.gstin as customer_gstin,
        i.invoice_number as invoice_number
      FROM debit_notes dn
      LEFT JOIN customers c ON dn.customer_id = c.id
      LEFT JOIN invoices i ON dn.invoice_id = i.id
      ${whereClause}
      ORDER BY dn.debit_note_date DESC, dn.created_at DESC
    `, params);

    return NextResponse.json({ debitNotes: debitNotes.rows });
  } catch (error: any) {
    console.error('Error fetching debit notes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch debit notes', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/debit-notes
 * Create a new debit note
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    const body = await request.json();
    const business_id = getBusinessIdFromRequest(request, body);
    const {
      branch_id: body_branch_id,
      customer_id,
      invoice_id,
      debit_note_number,
      debit_note_date,
      reason,
      place_of_supply_state_code,
      original_invoice_date,
      items,
      subtotal,
      discount_total,
      tax_total,
      cgst_total,
      sgst_total,
      igst_total,
      round_off,
      grand_total,
      notes,
      created_by,
    } = body;

    if (!business_id || !debit_note_number || !debit_note_date || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'business_id, debit_note_number, debit_note_date, and items are required' },
        { status: 400 }
      );
    }

    if (!created_by) {
      return NextResponse.json(
        { error: 'created_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    let resolvedBranchId: string | null = body_branch_id ?? null;
    if (!resolvedBranchId && invoice_id) {
      const invoiceRes = await client.query(
        'SELECT branch_id FROM invoices WHERE id = $1 AND business_id = $2',
        [invoice_id, business_id]
      );
      if (invoiceRes.rows.length > 0 && invoiceRes.rows[0].branch_id) {
        resolvedBranchId = invoiceRes.rows[0].branch_id;
      }
    }

    if (!resolvedBranchId) {
      const primaryBranch = await client.query(
        'SELECT id FROM branches WHERE business_id = $1 AND is_primary = true AND is_active = true LIMIT 1',
        [business_id]
      );
      if (primaryBranch.rows.length > 0) {
        resolvedBranchId = primaryBranch.rows[0].id;
      }
    }

    let stockBranchId: string;
    try {
      stockBranchId = await resolveBranchId({ businessId: business_id, branchId: resolvedBranchId });
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || 'Could not resolve branch for debit note' },
        { status: 400 }
      );
    }

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);
    let defaultWarehouseId: string | null = null;
    if (warehouseModeEnabled) {
      const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
      defaultWarehouseId = await getDefaultWarehouseForBranch(stockBranchId);
      if (!defaultWarehouseId) {
        return NextResponse.json(
          {
            error:
              'Warehouse mode is enabled but no default warehouse is configured for this branch. Configure a default warehouse before posting debit notes that affect stock.',
            code: 'WAREHOUSE_REQUIRED',
          },
          { status: 400 }
        );
      }
    }

    try {
      await authorize(created_by, 'debit_notes', 'create', {
        businessId: business_id,
        branchId: stockBranchId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await enforceAccess({
        businessId: business_id,
        userId: created_by,
        branchId: stockBranchId,
        feature: FeatureKeys.DEBIT_NOTES,
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }

    const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
    try {
      await assertGstPeriodNotFiledForDocumentDate(business_id, stockBranchId, debit_note_date, 'save debit note');
    } catch (error: any) {
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
      await assertPeriodNotLocked(business_id, stockBranchId, debit_note_date, 'debit note');
    } catch (error: any) {
      return NextResponse.json(
        {
          error: error.message || 'Period is locked',
          code: 'PERIOD_LOCKED',
        },
        { status: 403 }
      );
    }

    await client.query('BEGIN');

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

    // Calculate place of supply state code if not provided
    let finalPosStateCode = place_of_supply_state_code;
    if (!finalPosStateCode && customer_id) {
      const customerRes = await client.query(
        'SELECT state, state_code FROM customers WHERE id = $1',
        [customer_id]
      );
      if (customerRes.rows.length > 0 && customerRes.rows[0].state_code) {
        finalPosStateCode = customerRes.rows[0].state_code;
      } else if (customerRes.rows.length > 0 && customerRes.rows[0].state) {
        finalPosStateCode = getStateCode(customerRes.rows[0].state);
      }
    }

    // Create debit note
    const debitNoteRes = await client.query(`
      INSERT INTO debit_notes (
        business_id, branch_id, customer_id, invoice_id, debit_note_number, debit_note_date,
        reason, place_of_supply_state_code, original_invoice_date,
        subtotal, discount_total, tax_total, cgst_total, sgst_total, igst_total,
        round_off, grand_total, notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [
      business_id,
      stockBranchId,
      customer_id || null,
      invoice_id || null,
      debit_note_number,
      debit_note_date,
      reason || null,
      finalPosStateCode || null,
      original_invoice_date || null,
      subtotal || 0,
      discount_total || 0,
      tax_total || 0,
      cgst_total || 0,
      sgst_total || 0,
      igst_total || 0,
      round_off || 0,
      grand_total || 0,
      notes || null,
      created_by || null,
    ]);

    const debitNote = debitNoteRes.rows[0];

    // Create debit note items and update stock (debit note reduces stock for additional charges)
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // Calculate GST breakdown for this item
      const posStateCode = finalPosStateCode?.substring(0, 2) || '';
      const isIntraState = posStateCode === businessStateCode;
      const taxableValue = (item.unit_price * item.qty) - (item.discount || 0);
      const totalTax = (taxableValue * (item.tax_rate || 0)) / 100;
      
      let itemCgst = 0, itemSgst = 0, itemIgst = 0;
      if (isIntraState) {
        itemCgst = totalTax / 2;
        itemSgst = totalTax / 2;
      } else {
        itemIgst = totalTax;
      }

      await client.query(`
        INSERT INTO debit_note_items (
          debit_note_id, item_id, description, hsn_sac, qty, unit, unit_price,
          discount_percent, discount_amount, tax_rate, tax_amount, cgst_amount, sgst_amount, igst_amount,
          taxable_value, line_total, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `, [
        debitNote.id, item.item_id || null, item.description || item.name, item.hsn_sac || null,
        item.qty || item.quantity, item.unit || 'PCS', item.unit_price || item.price,
        item.discount_percent || 0, item.discount_amount || item.discount || 0,
        item.tax_rate || item.taxPercent || 0, item.tax_amount || totalTax,
        itemCgst, itemSgst, itemIgst, item.taxable_value || taxableValue,
        item.line_total || item.total || (taxableValue + totalTax), i
      ]);

      // Update stock if item exists (debit note = additional charge, so stock goes out)
      if (item.item_id) {
        // Check if item is goods (services don't update stock)
        const itemTypeRes = await client.query('SELECT item_type FROM items WHERE id = $1', [item.item_id]);
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
              business_id, item_id, type, quantity, reference_type, reference_id, location_id
            )
            VALUES ($1, $2, 'out', $3, 'debit_note', $4, $5)
          `,
            [business_id, item.item_id, qty, debitNote.id, warehouseModeEnabled ? defaultWarehouseId : null]
          );
        }
      }
    }

    // Update invoice balance if linked (debit note increases amount due; sync payment_status)
    if (invoice_id) {
      const invUp = await client.query(
        `
        UPDATE invoices 
        SET 
          balance_amount = balance_amount + $1,
          grand_total = grand_total + $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING grand_total, paid_amount, balance_amount
        `,
        [grand_total, invoice_id]
      );
      const row = invUp.rows[0];
      if (row) {
        const ps = deriveInvoicePaymentStatus(row.grand_total, row.paid_amount, row.balance_amount);
        await client.query(
          `UPDATE invoices SET payment_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [ps, invoice_id]
        );
      }
    }

    // Update customer receivable (debit note increases receivable)
    if (customer_id) {
      await client.query(`
        UPDATE customers 
        SET total_receivable = COALESCE(total_receivable, 0) + $1 
        WHERE id = $2
      `, [grand_total, customer_id]);
    }

    // Calculate COGS for inventory items
    let totalCogsAmount = 0;
    if (customer_id) {
      for (const item of items) {
        if (item.item_id) {
          const itemData = await client.query(
            'SELECT purchase_price, item_type FROM items WHERE id = $1',
            [item.item_id]
          );
          
          if (itemData.rows[0]?.item_type === 'goods' && itemData.rows[0]?.purchase_price) {
            const itemCost = Number(itemData.rows[0].purchase_price) || 0;
            const quantity = Number(item.qty || item.quantity || 0);
            totalCogsAmount += itemCost * quantity;
          }
        }
      }
    }

    // PHASE-5: ledger posting runs INSIDE the transaction on the same client
    // so the deferred validate_voucher_balance trigger sees all lines at COMMIT.
    await createDebitNoteLedgerEntries({
      businessId: business_id,
      debitNoteId: debitNote.id,
      debitNoteNumber: debit_note_number,
      debitNoteDate: debit_note_date,
      grandTotal: grand_total,
      customerId: customer_id,
      branchId: stockBranchId,
      cogsAmount: totalCogsAmount,
      taxableValue: subtotal ?? 0,
      cgstTotal: Number(cgst_total) || 0,
      sgstTotal: Number(sgst_total) || 0,
      igstTotal: Number(igst_total) || 0,
      poolClient: client,
    });

    await client.query('COMMIT');

    return NextResponse.json({ debitNote }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating debit note:', error);
    return NextResponse.json(
      { error: 'Failed to create debit note', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
