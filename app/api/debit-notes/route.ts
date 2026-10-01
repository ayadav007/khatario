import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getStateCode } from '@/lib/gst-utils';
import { createDebitNoteLedgerEntries } from '@/lib/ledger-utils';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getUserIdFromRequest, getBusinessIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { enforceAccess, enforceAccessErrorResponse, isPrimaryAdminForBusiness } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { resolveBranchId } from '@/lib/branch-helpers';
import { recomputeInvoiceBalance } from '@/lib/invoices/invoice-balance';
import { computeLineGst, round2 } from '@/lib/invoices/line-gst';

export const dynamic = 'force-dynamic';

async function nextDebitNoteNumber(
  db: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ max_used: string | null }> }> },
  businessId: string
): Promise<string> {
  const res = await db.query(
    `SELECT MAX(SUBSTRING(debit_note_number FROM '(\\d+)$')::bigint) AS max_used
       FROM debit_notes
      WHERE business_id = $1 AND debit_note_number ~ '\\d+$'`,
    [businessId]
  );
  const next = Number(res.rows[0]?.max_used || 0) + 1;
  return `DN-${String(next).padStart(3, '0')}`;
}

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

    if (request.nextUrl.searchParams.get('next_number') === '1') {
      return NextResponse.json({ next_debit_note_number: await nextDebitNoteNumber(getPool(), business_id) });
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
    const business_id = getSessionScopedBusinessId(request);
    const created_by = getAuthenticatedUserId(request);
    if (!business_id || !created_by) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const {
      branch_id: body_branch_id,
      customer_id,
      invoice_id,
      debit_note_number: requestedDebitNoteNumber,
      debit_note_date,
      reason,
      place_of_supply_state_code,
      original_invoice_date,
      items,
      round_off,
      notes,
    } = body;

    if (!customer_id || !debit_note_date || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'customer_id, debit_note_date, and items are required' },
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
    
    const { resolveSupplierRegistration } = await import('@/lib/gst/registration');
    const businessStateCode =
      (await resolveSupplierRegistration(client, business_id, stockBranchId)).stateCode ||
      businessRes.rows[0].state_code ||
      '';

    const rejectDebitNote = async (status: number, code: string, error: string) => {
      await client.query('ROLLBACK');
      return NextResponse.json({ error, code }, { status });
    };

    const customerRes = await client.query<{ state: string | null; state_code: string | null; gstin: string | null }>(
      'SELECT state, state_code, gstin FROM customers WHERE id = $1 AND business_id = $2',
      [customer_id, business_id]
    );
    const noteCustomer = customerRes.rows[0];
    if (!noteCustomer) {
      return rejectDebitNote(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    if (noteCustomer.gstin && noteCustomer.gstin.trim() && !invoice_id) {
      return rejectDebitNote(
        400,
        'ORIGINAL_INVOICE_REQUIRED',
        'A debit note to a registered customer must reference the original invoice (s.34 CGST Act; reported in GSTR-1 CDNR)'
      );
    }

    let linkedInvoice: { customer_id: string | null; status: string; place_of_supply_state_code: string | null; invoice_date: string } | null = null;
    if (invoice_id) {
      const invRes = await client.query(
        'SELECT customer_id, status, place_of_supply_state_code, invoice_date FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
        [invoice_id, business_id]
      );
      linkedInvoice = invRes.rows[0] ?? null;
      if (!linkedInvoice) return rejectDebitNote(404, 'INVOICE_NOT_FOUND', 'Linked invoice not found');
      if (linkedInvoice.status !== 'final') {
        return rejectDebitNote(400, 'INVOICE_NOT_FINAL', 'A debit note can only be issued against a final invoice');
      }
      if (linkedInvoice.customer_id && linkedInvoice.customer_id !== customer_id) {
        return rejectDebitNote(400, 'CUSTOMER_MISMATCH', 'The linked invoice belongs to a different customer');
      }
    }

    await client.query(`SELECT pg_advisory_xact_lock(hashtext('debit_note_number:' || $1::text))`, [business_id]);
    const debit_note_number =
      requestedDebitNoteNumber && String(requestedDebitNoteNumber).trim()
        ? String(requestedDebitNoteNumber).trim()
        : await nextDebitNoteNumber(client, business_id);
    const dupRes = await client.query(
      'SELECT 1 FROM debit_notes WHERE business_id = $1 AND debit_note_number = $2 LIMIT 1',
      [business_id, debit_note_number]
    );
    if (dupRes.rows.length > 0) {
      return rejectDebitNote(409, 'DUPLICATE_NUMBER', `Debit note number ${debit_note_number} already exists`);
    }

    let finalPosStateCode = linkedInvoice?.place_of_supply_state_code || place_of_supply_state_code;
    if (!finalPosStateCode) {
      finalPosStateCode =
        noteCustomer.state_code ||
        (noteCustomer.gstin ? noteCustomer.gstin.trim().slice(0, 2) : '') ||
        (noteCustomer.state ? getStateCode(noteCustomer.state) : '');
    }

    const intraState = (finalPosStateCode?.substring(0, 2) || '') === businessStateCode;
    const lines = (items as any[]).map((item) => {
      const qty = Number(item.qty ?? item.quantity) || 0;
      const unitPrice = Number(item.unit_price ?? item.price) || 0;
      const gross = qty * unitPrice;
      const discountPercent = Number(item.discount_percent) || 0;
      const discount = round2(
        discountPercent > 0 ? (gross * discountPercent) / 100 : Number(item.discount_amount ?? item.discount) || 0
      );
      const line = computeLineGst(
        { quantity: 1, unit_price: gross - discount, tax_rate: item.tax_rate ?? item.taxPercent },
        intraState,
        false
      );
      return { item, qty, unitPrice, discount, ...line, taxRate: Number(item.tax_rate ?? item.taxPercent) || 0 };
    });
    const { gstRateError } = await import('@/lib/gst/rates');
    const invDate: unknown = linkedInvoice?.invoice_date;
    const rateDate =
      invDate instanceof Date
        ? `${invDate.getFullYear()}-${String(invDate.getMonth() + 1).padStart(2, '0')}-${String(invDate.getDate()).padStart(2, '0')}`
        : String(invDate ?? debit_note_date).slice(0, 10);
    for (const l of lines) {
      const rateError = gstRateError(l.taxRate, rateDate);
      if (rateError) {
        return rejectDebitNote(400, 'INVALID_GST_RATE', `${l.item?.item_name || 'Line'}: ${rateError}`);
      }
    }
    const computedSubtotal = round2(lines.reduce((s, l) => s + l.taxable, 0));
    const computedDiscount = round2(lines.reduce((s, l) => s + l.discount, 0));
    const computedCgst = round2(lines.reduce((s, l) => s + l.cgst, 0));
    const computedSgst = round2(lines.reduce((s, l) => s + l.sgst, 0));
    const computedIgst = round2(lines.reduce((s, l) => s + l.igst, 0));
    const computedTax = round2(computedCgst + computedSgst + computedIgst);
    const roundOffValue = round2(Number(round_off) || 0);
    const computedGrandTotal = round2(computedSubtotal + computedTax + roundOffValue);

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
      original_invoice_date || linkedInvoice?.invoice_date || null,
      computedSubtotal,
      computedDiscount,
      computedTax,
      computedCgst,
      computedSgst,
      computedIgst,
      roundOffValue,
      computedGrandTotal,
      notes || null,
      created_by || null,
    ]);

    const debitNote = debitNoteRes.rows[0];

    // Create debit note items and update stock (debit note reduces stock for additional charges)
    for (let i = 0; i < lines.length; i++) {
      const { item, qty, unitPrice, discount, taxable, cgst, sgst, igst, taxAmount, lineTotal, taxRate } = lines[i];

      await client.query(`
        INSERT INTO debit_note_items (
          debit_note_id, item_id, description, hsn_sac, qty, unit, unit_price,
          discount, tax_rate, tax_amount, cgst_amount, sgst_amount, igst_amount,
          taxable_value, line_total, sort_order
        )
        VALUES ($1, $2, $3, COALESCE(NULLIF(TRIM($4::text), ''), (SELECT hsn_sac FROM items WHERE id = $2::uuid)),
                $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `, [
        debitNote.id, item.item_id || null, item.description || item.name || 'Adjustment', item.hsn_sac || null,
        qty, item.unit || 'PCS', unitPrice,
        discount, taxRate, taxAmount,
        cgst, sgst, igst, taxable,
        lineTotal, i
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

    // Linked invoice keeps its original value (reported as issued in GSTR-1); the note only
    // raises the amount still due on it, mirroring how credit notes reduce it.
    if (invoice_id) {
      await recomputeInvoiceBalance(client, invoice_id, business_id);
    }

    // Update customer receivable (debit note increases receivable)
    if (customer_id) {
      await client.query(`
        UPDATE customers 
        SET current_balance = COALESCE(current_balance, 0) + $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND business_id = $3
      `, [computedGrandTotal, customer_id, business_id]);
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
      grandTotal: computedGrandTotal,
      customerId: customer_id,
      branchId: stockBranchId,
      cogsAmount: totalCogsAmount,
      taxableValue: computedSubtotal,
      cgstTotal: computedCgst,
      sgstTotal: computedSgst,
      igstTotal: computedIgst,
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
