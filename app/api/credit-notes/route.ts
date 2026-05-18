import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { createCreditNoteLedgerEntries } from '@/lib/ledger-utils';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { FeatureKeys } from '@/lib/featureKeys';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { enforceAccess, enforceAccessErrorResponse, isPrimaryAdminForBusiness } from '@/lib/enforce-access';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { deriveInvoicePaymentStatus } from '@/lib/invoice-payment-status';

/**
 * GET /api/credit-notes
 * Fetch all credit notes for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId) {
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

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'credit_notes', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;
    const search = searchParams.get('search') || '';

    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      return NextResponse.json({ 
        creditNotes: [],
        pagination: {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0
        }
      });
    }

    const isAdmin = await isPrimaryAdminForBusiness(userId, businessId).catch(() => false);

    const pool = getPool();
    
    // Build query with search
    let whereClause = 'WHERE cn.business_id = $1';
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (!isAdmin) {
      if (accessibleBranchIds.length === 0) {
        return NextResponse.json({ 
          creditNotes: [],
          pagination: {
            page: 1,
            limit: 50,
            total: 0,
            totalPages: 0
          }
        });
      }
      whereClause += ` AND cn.branch_id = ANY($${paramIndex}::uuid[])`;
      params.push(accessibleBranchIds);
      paramIndex++;
    }

    if (search) {
      whereClause += ` AND (cn.credit_note_number ILIKE $${paramIndex} OR c.name ILIKE $${paramIndex} OR i.invoice_number ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Get total count
    const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM credit_notes cn
      LEFT JOIN customers c ON cn.customer_id = c.id
      LEFT JOIN invoices i ON cn.invoice_id = i.id
      ${whereClause}
    `, params);
    const total = parseInt(countResult.rows[0]?.total || '0');

    // Get paginated results
    const result = await pool.query(`
      SELECT 
        cn.*,
        c.name as customer_name,
        c.phone as customer_phone,
        c.gstin as customer_gstin,
        i.invoice_number as invoice_number
      FROM credit_notes cn
      LEFT JOIN customers c ON cn.customer_id = c.id
      LEFT JOIN invoices i ON cn.invoice_id = i.id
      ${whereClause}
      ORDER BY cn.credit_note_date DESC, cn.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limit, offset]);

    return NextResponse.json({ 
      creditNotes: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching credit notes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch credit notes', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/credit-notes
 * Create a new credit note (sales return - customer returns goods)
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    const body = await request.json();
    const business_id = getBusinessIdFromRequest(request, body);
    const {
      branch_id, // MANDATORY: Branch (accounting entity) that issued this credit note
      customer_id,
      invoice_id,
      credit_note_number,
      credit_note_date,
      original_invoice_date,
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
      refund_amount,
      notes,
      created_by,
    } = body;

    if (!business_id || !customer_id || !credit_note_number || !credit_note_date || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'business_id, customer_id, credit_note_number, credit_note_date, and items are required' },
        { status: 400 }
      );
    }

    if (!created_by) {
      return NextResponse.json(
        { error: 'created_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    // If invoice_id provided, try to get branch_id from invoice first
    let resolvedBranchId = branch_id;
    if (!resolvedBranchId && invoice_id) {
      const invoiceRes = await client.query(`
        SELECT branch_id FROM invoices WHERE id = $1 AND business_id = $2
      `, [invoice_id, business_id]);
      
      if (invoiceRes.rows.length > 0 && invoiceRes.rows[0].branch_id) {
        resolvedBranchId = invoiceRes.rows[0].branch_id;
      }
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: resolvedBranchId,
        businessId: business_id,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }
      throw error;
    }

    try {
      await authorize(created_by, 'credit_notes', 'create', { 
        businessId: business_id,
        branchId: finalBranchId,
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
        branchId: finalBranchId,
        feature: FeatureKeys.CREDIT_NOTES,
        limitType: 'credit_notes',
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }

    const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
    try {
      await assertGstPeriodNotFiledForDocumentDate(business_id, finalBranchId, credit_note_date, 'save credit note');
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
      await assertPeriodNotLocked(business_id, finalBranchId, credit_note_date, 'credit note');
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

    // Calculate place of supply if not provided
    let finalPosStateCode = place_of_supply_state_code;
    if (!finalPosStateCode && customer_id) {
      const customerRes = await client.query(
        'SELECT state_code FROM customers WHERE id = $1',
        [customer_id]
      );
      if (customerRes.rows.length > 0) {
        finalPosStateCode = customerRes.rows[0].state_code;
      }
    }

    // Create credit note record
    const creditNoteResult = await client.query(`
      INSERT INTO credit_notes (
        business_id, branch_id, customer_id, invoice_id, credit_note_number, credit_note_date,
        original_invoice_date, reason, place_of_supply_state_code,
        subtotal, discount_total, tax_total, cgst_total, sgst_total, igst_total,
        round_off, grand_total, refund_status, refund_mode, refund_date, refund_amount,
        notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      RETURNING *
    `, [
      business_id, finalBranchId, customer_id, invoice_id, credit_note_number, credit_note_date,
      original_invoice_date, reason, finalPosStateCode,
      subtotal, discount_total, tax_total, cgst_total, sgst_total, igst_total,
      round_off, grand_total, refund_status, refund_mode, refund_date, refund_amount,
      notes, created_by
    ]);

    const creditNote = creditNoteResult.rows[0];

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);

    // Insert credit note items and increase stock (goods coming back)
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      await client.query(`
        INSERT INTO credit_note_items (
          credit_note_id, item_id, description, qty, unit, unit_price,
          discount, tax_rate, tax_amount, line_total, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        creditNote.id,
        item.item_id || null,
        item.description || item.item_name,
        item.qty || item.quantity,
        item.unit || 'PCS',
        item.unit_price,
        item.discount || 0,
        item.tax_rate || 0,
        item.tax_amount || 0,
        item.line_total,
        i
      ]);

      // Get location_id from original invoice if available
      let locationId = item.location_id || null;
      if (!locationId && invoice_id) {
        const invoiceItemRes = await client.query(`
          SELECT location_id FROM invoice_items 
          WHERE invoice_id = $1 AND item_id = $2 
          LIMIT 1
        `, [invoice_id, item.item_id]);
        if (invoiceItemRes.rows.length > 0) {
          locationId = invoiceItemRes.rows[0].location_id;
        }
      }

      // Update credit_note_items with location_id
      if (locationId) {
        await client.query(`
          UPDATE credit_note_items
          SET location_id = $1
          WHERE credit_note_id = $2 AND item_id = $3
        `, [locationId, creditNote.id, item.item_id]);
      }

      // Increase stock (goods returned by customer)
      if (item.item_id) {
        // Check if item is goods (services don't update stock)
        const itemTypeRes = await client.query('SELECT item_type FROM items WHERE id = $1', [item.item_id]);
        const itemType = itemTypeRes.rows[0]?.item_type || 'goods';

        if (itemType === 'goods') {
          const returnQty = parseFloat(item.qty || item.quantity || '0');
          
          if (warehouseModeEnabled) {
            if (!locationId) {
              await client.query('ROLLBACK');
              return NextResponse.json(
                {
                  error: `location_id (warehouse) is required for credit note line item "${item.item_name || item.item_id}".`,
                  code: 'WAREHOUSE_REQUIRED',
                },
                { status: 400 }
              );
            }
            await client.query(
              `
              SELECT * FROM location_stock 
              WHERE location_id = $1 AND item_id = $2
              FOR UPDATE
            `,
              [locationId, item.item_id]
            );
            await client.query(
              `
              INSERT INTO location_stock (location_id, item_id, current_stock_qty)
              VALUES ($1, $2, $3)
              ON CONFLICT (location_id, item_id)
              DO UPDATE SET 
                current_stock_qty = location_stock.current_stock_qty + $3,
                last_updated = CURRENT_TIMESTAMP
            `,
              [locationId, item.item_id, returnQty]
            );
          } else {
            await adjustBranchItemStock(client, business_id, finalBranchId, item.item_id, returnQty);
            await refreshItemGlobalStockFromBranches(client, business_id, item.item_id);
          }

          // Record stock movement
          await client.query(`
            INSERT INTO stock_movements (
              business_id, item_id, location_id, type, quantity, reference_type, reference_id, notes
            )
            VALUES ($1, $2, $3, 'in', $4, 'credit_note', $5, $6)
          `, [
            business_id,
            item.item_id,
            locationId,
            returnQty,
            creditNote.id,
            `Sales Return: ${credit_note_number}`
          ]);
        }
      }
    }

    // Update customer balance (customer owes less now)
    await client.query(`
      UPDATE customers
      SET current_balance = current_balance - $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [grand_total, customer_id]);

    // Update linked invoice balance if applicable (keep payment_status in sync)
    if (invoice_id) {
      const invUp = await client.query(
        `
        UPDATE invoices
        SET balance_amount = balance_amount - $1,
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

    // Calculate COGS (Cost of Goods Sold) for returned items
    let totalCogsAmount = 0;
    for (const item of items) {
      if (item.item_id) {
        // Get item purchase price or cost
        const itemData = await client.query(
          'SELECT purchase_price, item_type FROM items WHERE id = $1',
          [item.item_id]
        );
        
        if (itemData.rows[0]?.item_type === 'goods' && itemData.rows[0]?.purchase_price) {
          const itemCost = Number(itemData.rows[0].purchase_price) || 0;
          const itemQuantity = Number(item.qty || item.quantity) || 0;
          totalCogsAmount += itemCost * itemQuantity;
        }
      }
    }

    // PHASE-5: ledger posting runs INSIDE the transaction on the same client,
    // so the deferred validate_voucher_balance trigger sees all lines at COMMIT.
    // If any line fails (constraint, missing account, etc.) the outer catch
    // ROLLBACKs and the credit note row never persists.
    await createCreditNoteLedgerEntries({
      businessId: business_id,
      creditNoteId: creditNote.id,
      creditNoteNumber: credit_note_number,
      creditNoteDate: credit_note_date,
      grandTotal: grand_total,
      customerId: customer_id,
      cogsAmount: totalCogsAmount,
      branchId: finalBranchId,
      // PHASE-3: GST split for credit notes — Output GST gets debited (reverses
      // the original Cr posted by the source invoice).
      taxableValue: subtotal,
      cgstTotal: cgst_total,
      sgstTotal: sgst_total,
      igstTotal: igst_total,
      poolClient: client,
    });

    await client.query('COMMIT');

    return NextResponse.json({ creditNote }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating credit note:', error);
    return NextResponse.json(
      { error: 'Failed to create credit note', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

