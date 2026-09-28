import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { createCreditNoteLedgerEntries } from '@/lib/ledger-utils';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { FeatureKeys } from '@/lib/featureKeys';
import { getUserIdFromRequest, getBusinessIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { computeLineGst, isZeroRatedWithoutTax, round2 } from '@/lib/invoices/line-gst';
import { enforceAccess, enforceAccessErrorResponse, isPrimaryAdminForBusiness } from '@/lib/enforce-access';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { recomputeInvoiceBalance } from '@/lib/invoices/invoice-balance';

export const dynamic = 'force-dynamic';

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

    if (searchParams.get('next_number') === '1') {
      const maxRes = await getPool().query<{ max_used: string | null }>(
        `SELECT MAX(SUBSTRING(credit_note_number FROM '(\\d+)$')::bigint) AS max_used
         FROM credit_notes
         WHERE business_id = $1 AND credit_note_number ~ '\\d+$'`,
        [businessId]
      );
      const next = Number(maxRes.rows[0]?.max_used || 0) + 1;
      return NextResponse.json({ next_credit_note_number: `CN-${String(next).padStart(3, '0')}` });
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
    const business_id = getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request, body);
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
      round_off,
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
    const customerRes = await client.query<{ state_code: string | null; gstin: string | null }>(
      'SELECT state_code, gstin FROM customers WHERE id = $1 AND business_id = $2',
      [customer_id, business_id]
    );
    const noteCustomer = customerRes.rows[0];
    if (!finalPosStateCode && noteCustomer) {
      finalPosStateCode = noteCustomer.state_code || (noteCustomer.gstin ? noteCustomer.gstin.trim().slice(0, 2) : null);
    }

    const rejectCreditNote = async (status: number, code: string, error: string) => {
      await client.query('ROLLBACK');
      return NextResponse.json({ error, code }, { status });
    };

    if (!noteCustomer) {
      return rejectCreditNote(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    if (noteCustomer.gstin && noteCustomer.gstin.trim() && !invoice_id) {
      return rejectCreditNote(
        400,
        'ORIGINAL_INVOICE_REQUIRED',
        'A credit note to a registered customer must reference the original invoice (s.34 CGST Act; reported in GSTR-1 CDNR)'
      );
    }

    let invoice: any = null;
    const invoicedByItem = new Map<string, { qty: number; taxRate: number }>();
    if (invoice_id) {
      const invRes = await client.query(
        `SELECT * FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [invoice_id, business_id]
      );
      invoice = invRes.rows[0];
      if (!invoice) return rejectCreditNote(404, 'INVOICE_NOT_FOUND', 'Linked invoice not found');
      if (invoice.status !== 'final') {
        return rejectCreditNote(400, 'INVOICE_NOT_FINAL', 'A credit note can only be issued against a final invoice');
      }
      if (invoice.customer_id && invoice.customer_id !== customer_id) {
        return rejectCreditNote(400, 'CUSTOMER_MISMATCH', 'The linked invoice belongs to a different customer');
      }
      if (invoice.place_of_supply_state_code) finalPosStateCode = invoice.place_of_supply_state_code;

      const invItems = await client.query(
        `SELECT item_id, SUM(quantity)::numeric AS qty, MAX(tax_rate)::numeric AS tax_rate
           FROM invoice_items WHERE invoice_id = $1 AND item_id IS NOT NULL GROUP BY item_id`,
        [invoice_id]
      );
      const credited = await client.query(
        `SELECT cni.item_id, SUM(cni.qty)::numeric AS qty
           FROM credit_note_items cni
           JOIN credit_notes cn ON cn.id = cni.credit_note_id
          WHERE cn.invoice_id = $1 AND cn.business_id = $2 AND cn.status = 'active' AND cni.item_id IS NOT NULL
          GROUP BY cni.item_id`,
        [invoice_id, business_id]
      );
      const creditedQty = new Map(credited.rows.map((r) => [r.item_id, Number(r.qty) || 0]));
      for (const r of invItems.rows) {
        invoicedByItem.set(r.item_id, {
          qty: (Number(r.qty) || 0) - (creditedQty.get(r.item_id) || 0),
          taxRate: Number(r.tax_rate) || 0,
        });
      }
    }

    const intraState = (finalPosStateCode?.substring(0, 2) || '') === businessStateCode;
    const zeroRated = invoice ? isZeroRatedWithoutTax(invoice) : false;
    const lines = (items as any[]).map((item) => {
      const qty = Number(item.qty ?? item.quantity) || 0;
      const unitPrice = Number(item.unit_price ?? item.price) || 0;
      const gross = qty * unitPrice;
      const discountPercent = Number(item.discount_percent) || 0;
      const discount = round2(
        discountPercent > 0 ? (gross * discountPercent) / 100 : Number(item.discount_amount ?? item.discount) || 0
      );
      const linked = item.item_id ? invoicedByItem.get(item.item_id) : undefined;
      const taxRate = linked ? linked.taxRate : Number(item.tax_rate) || 0;
      const line = computeLineGst({ quantity: 1, unit_price: gross - discount, tax_rate: taxRate }, intraState, zeroRated);
      return { item, qty, unitPrice, discount, taxRate: zeroRated ? 0 : taxRate, ...line };
    });

    if (lines.some((l) => l.qty <= 0 || l.taxable < 0)) {
      return rejectCreditNote(400, 'INVALID_LINE', 'Each credit note line needs a positive quantity and value');
    }

    if (invoice) {
      const requested = new Map<string, number>();
      for (const l of lines) {
        if (!l.item.item_id) continue;
        if (!invoicedByItem.has(l.item.item_id)) {
          return rejectCreditNote(
            400,
            'ITEM_NOT_ON_INVOICE',
            `"${l.item.item_name || l.item.description || l.item.item_id}" is not on invoice ${invoice.invoice_number}`
          );
        }
        requested.set(l.item.item_id, (requested.get(l.item.item_id) || 0) + l.qty);
      }
      for (const [itemId, qty] of requested) {
        const available = invoicedByItem.get(itemId)!.qty;
        if (qty > available + 1e-9) {
          const name = lines.find((l) => l.item.item_id === itemId)?.item.item_name || itemId;
          return rejectCreditNote(
            400,
            'RETURN_EXCEEDS_INVOICED',
            `Return quantity for "${name}" (${qty}) exceeds the quantity still open on invoice ${invoice.invoice_number} (${Math.max(0, available)})`
          );
        }
      }
    }

    const computedSubtotal = round2(lines.reduce((s, l) => s + l.taxable, 0));
    const computedDiscount = round2(lines.reduce((s, l) => s + l.discount, 0));
    const computedCgst = round2(lines.reduce((s, l) => s + l.cgst, 0));
    const computedSgst = round2(lines.reduce((s, l) => s + l.sgst, 0));
    const computedIgst = round2(lines.reduce((s, l) => s + l.igst, 0));
    const computedTax = round2(computedCgst + computedSgst + computedIgst);
    const computedRoundOff = round2(Number(round_off) || 0);
    if (Math.abs(computedRoundOff) >= 1) {
      return rejectCreditNote(400, 'INVALID_ROUND_OFF', 'Round off must be less than ₹1');
    }
    const computedGrandTotal = round2(computedSubtotal + computedTax + computedRoundOff);

    if (invoice) {
      const prior = await client.query(
        `SELECT
           COALESCE((SELECT SUM(grand_total) FROM credit_notes
                      WHERE invoice_id = $1 AND business_id = $2 AND status = 'active'), 0) AS credited,
           COALESCE((SELECT SUM(grand_total) FROM debit_notes
                      WHERE invoice_id = $1 AND business_id = $2 AND status = 'active'), 0) AS debited`,
        [invoice_id, business_id]
      );
      const creditable = round2(
        Number(invoice.grand_total) + Number(prior.rows[0].debited) - Number(prior.rows[0].credited)
      );
      if (computedGrandTotal > creditable + 0.005) {
        return rejectCreditNote(
          400,
          'CREDIT_EXCEEDS_INVOICE',
          `Credit note total ₹${computedGrandTotal.toFixed(2)} exceeds the ₹${Math.max(0, creditable).toFixed(2)} still creditable on invoice ${invoice.invoice_number}`
        );
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
      business_id, finalBranchId, customer_id, invoice_id || null, credit_note_number, credit_note_date,
      original_invoice_date || (invoice ? invoice.invoice_date : null), reason, finalPosStateCode,
      computedSubtotal, computedDiscount, computedTax, computedCgst, computedSgst, computedIgst,
      computedRoundOff, computedGrandTotal, refund_status, refund_mode, refund_date, refund_amount,
      notes, created_by
    ]);

    const creditNote = creditNoteResult.rows[0];

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);

    // Insert credit note items and increase stock (goods coming back)
    for (let i = 0; i < lines.length; i++) {
      const { item, qty, unitPrice, discount, taxRate, taxAmount, lineTotal } = lines[i];
      
      await client.query(`
        INSERT INTO credit_note_items (
          credit_note_id, item_id, description, qty, unit, unit_price,
          discount, tax_rate, tax_amount, line_total, sort_order, hsn_sac
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                COALESCE(NULLIF(TRIM($12::text), ''), (SELECT hsn_sac FROM items WHERE id = $2::uuid)))
      `, [
        creditNote.id,
        item.item_id || null,
        item.description || item.item_name || 'Adjustment',
        qty,
        item.unit || 'PCS',
        unitPrice,
        discount,
        taxRate,
        taxAmount,
        lineTotal,
        i,
        item.hsn_sac || null,
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
      WHERE id = $2 AND business_id = $3
    `, [computedGrandTotal, customer_id, business_id]);

    // Update linked invoice balance if applicable (keep payment_status in sync)
    if (invoice_id) {
      await recomputeInvoiceBalance(client, invoice_id, business_id);
    }

    // Calculate COGS (Cost of Goods Sold) for returned items
    let totalCogsAmount = 0;
    for (const { item } of lines) {
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
      grandTotal: computedGrandTotal,
      customerId: customer_id,
      cogsAmount: totalCogsAmount,
      branchId: finalBranchId,
      // PHASE-3: GST split for credit notes — Output GST gets debited (reverses
      // the original Cr posted by the source invoice).
      taxableValue: computedSubtotal,
      cgstTotal: computedCgst,
      sgstTotal: computedSgst,
      igstTotal: computedIgst,
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

