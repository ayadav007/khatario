import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { allocateStockOnPurchase } from '@/lib/stock-valuation';
import { resolveBranchId } from '@/lib/branch-helpers';
import { resolveSupplierRegistration } from '@/lib/gst/registration';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { periodGuardResponse } from '@/lib/http/period-guards';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';

export const dynamic = 'force-dynamic';

/**
 * POST /api/invoices/[id]/convert-to-purchase
 * Convert an invoice (received from supplier) to a purchase
 * This is used when a customer receives an invoice from their supplier
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    const invoiceId = params.id;
    const body = await request.json();
    const { branch_id: bodyBranchId } = body;
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;
    
    // Check which columns exist BEFORE starting transaction
    const itemColumnsCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'items' 
      AND column_name IN ('track_batch', 'track_serial', 'item_type')
    `);
    const availableItemColumns = new Set(itemColumnsCheck.rows.map(row => row.column_name));
    const hasTrackBatch = availableItemColumns.has('track_batch');
    const hasTrackSerial = availableItemColumns.has('track_serial');
    const hasItemType = availableItemColumns.has('item_type');
    
    const stockMovementColumnsCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'stock_movements' 
      AND column_name IN ('unit_cost', 'batch_id', 'serial_id')
    `);
    const availableStockColumns = new Set(stockMovementColumnsCheck.rows.map(row => row.column_name));
    const hasUnitCost = availableStockColumns.has('unit_cost');
    const hasBatchId = availableStockColumns.has('batch_id');
    const hasSerialId = availableStockColumns.has('serial_id');
    
    await client.query('BEGIN');

    // The invoice belongs to the supplier's business, not the caller's: load it by id and
    // decide access from the hub relationship below.
    const invoiceRes = await client.query(`
      SELECT 
        i.*,
        b.id as supplier_business_id,
        b.name as supplier_business_name,
        b.state as supplier_state,
        b.state_code as supplier_state_code,
        b.gstin as supplier_gstin
      FROM invoices i
      LEFT JOIN businesses b ON i.business_id = b.id
      WHERE i.id = $1
        AND i.deleted_at IS NULL
        AND COALESCE(i.status, '') NOT IN ('draft', 'cancelled')
        AND COALESCE(i.document_type, '') <> 'proforma_invoice'
    `, [invoiceId]);

    if (invoiceRes.rows.length === 0 || invoiceRes.rows[0].business_id === business_id) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const invoice = invoiceRes.rows[0];

    // The caller must have an approved link to the issuing business...
    const supplierRes = await client.query(`
      SELECT id FROM suppliers
      WHERE business_id = $1
        AND linked_business_id = $2
        AND approval_status = 'approved'
        AND deleted_at IS NULL
      LIMIT 1
    `, [business_id, invoice.business_id]);
    const supplierId: string | null = supplierRes.rows[0]?.id ?? null;

    // ...and the invoice must be addressed to the caller: it fulfils one of the caller's
    // quantity requests, its customer record is linked to the caller, or its recipient GSTIN
    // is one of the caller's registrations.
    const requestRes = await client.query(`
      SELECT qr.id, qr.requester_business_id, qr.responder_business_id, qr.item_id,
             qr.responder_item_id, i.business_id AS item_business_id
      FROM quantity_requests qr
      JOIN items i ON i.id = qr.item_id
      WHERE qr.invoice_id = $1
    `, [invoiceId]);
    const { partiesFromItemOwner } = await import('@/lib/quantity-request-parties');
    const linkedRequests = requestRes.rows.filter((r: any) => {
      const parties = partiesFromItemOwner(
        r.requester_business_id, r.responder_business_id, r.item_business_id, r.item_id
      );
      return parties?.buyerBusinessId === business_id && parties.vendorBusinessId === invoice.business_id;
    });

    let addressedToCaller = linkedRequests.length > 0;
    let accessReason = addressedToCaller ? 'linked to request' : '';
    if (!addressedToCaller && invoice.customer_id) {
      const linkedRes = await client.query(
        `SELECT 1 FROM customers WHERE id = $1 AND business_id = $2 AND linked_business_id = $3`,
        [invoice.customer_id, invoice.business_id, business_id]
      );
      addressedToCaller = linkedRes.rows.length > 0;
      if (addressedToCaller) accessReason = 'linked customer';
    }
    const recipientGstin = String(invoice.customer_gstin || '').trim().toUpperCase();
    if (!addressedToCaller && recipientGstin) {
      const gstinRes = await client.query(`
        SELECT 1 FROM businesses WHERE id = $1 AND UPPER(TRIM(gstin)) = $2
        UNION ALL
        SELECT 1 FROM branches WHERE business_id = $1 AND UPPER(TRIM(gstin)) = $2
        LIMIT 1
      `, [business_id, recipientGstin]);
      addressedToCaller = gstinRes.rows.length > 0;
      if (addressedToCaller) accessReason = 'recipient GSTIN';
    }

    if (!supplierId || !addressedToCaller) {
      await client.query('ROLLBACK');
      console.error('[Convert Invoice] Access denied:', {
        invoiceId,
        business_id,
        invoice_business_id: invoice.business_id,
        hasApprovedLink: !!supplierId,
        linkedRequests: linkedRequests.length,
      });
      return NextResponse.json({ 
        error: supplierId
          ? 'This invoice is not addressed to your business'
          : 'The issuing business is not an approved linked supplier of yours',
      }, { status: 403 });
    }
    
    console.log('[Convert Invoice] Access granted:', { invoiceId, business_id, reason: accessReason });

    let purchaseBranchId: string;
    try {
      purchaseBranchId = await resolveBranchId({
        businessId: business_id,
        branchId: bodyBranchId ?? null,
      });
    } catch (e: any) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: e?.message || 'Could not resolve branch for purchase' },
        { status: 400 }
      );
    }

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
      await authorize(userId, 'purchases', 'create', { businessId: business_id, branchId: purchaseBranchId });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }
    const guard = await periodGuardResponse({
      businessId: business_id,
      branchId: purchaseBranchId,
      dates: [invoice.invoice_date],
      action: 'convert this invoice into a purchase',
      checkGstFiled: true,
    });
    if (guard) {
      await client.query('ROLLBACK');
      return guard;
    }

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);
    let defaultWarehouseId: string | null = null;
    if (warehouseModeEnabled) {
      const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
      defaultWarehouseId = await getDefaultWarehouseForBranch(purchaseBranchId);
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

    // Check if already converted (a cancelled purchase frees the invoice again)
    const existingPurchaseRes = await client.query(`
      SELECT id FROM purchases 
      WHERE business_id = $1 
        AND status <> 'cancelled'
        AND (
          source_invoice_id = $2
          OR (supplier_id = $3 AND bill_number = $4)
        )
      LIMIT 1
    `, [business_id, invoiceId, supplierId, invoice.invoice_number]);
    
    if (existingPurchaseRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ 
        error: 'Purchase already exists for this invoice',
        purchase_id: existingPurchaseRes.rows[0].id
      }, { status: 400 });
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(business_id, 'purchase_management');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Fetch invoice items
    const itemsRes = await client.query(`
      SELECT ii.*, COALESCE(vi.item_type, 'goods') AS vendor_item_type
      FROM invoice_items ii
      LEFT JOIN items vi ON vi.id = ii.item_id
      WHERE ii.invoice_id = $1
      ORDER BY ii.sort_order ASC
    `, [invoiceId]);

    const invoiceItems = itemsRes.rows;

    if (invoiceItems.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Invoice has no items' }, { status: 400 });
    }

    // Resolve each supplier line to the caller's own item. Sources, in order: the caller's
    // explicit choice (body.item_map: invoice_item_id -> own item id), the item mapping saved
    // on a linked quantity request, then an exact name match. Goods lines that stay unmatched
    // stop the conversion so stock is never silently skipped.
    const explicitMap: Record<string, string> =
      body.item_map && typeof body.item_map === 'object' ? body.item_map : {};
    const requestMap = new Map<string, string>();
    for (const r of linkedRequests) {
      if (r.responder_item_id) requestMap.set(String(r.responder_item_id), String(r.item_id));
    }
    const ownItems = new Map<string, { id: string; unit: string | null }>();
    const ownItemIds = Array.from(new Set([...Object.values(explicitMap), ...requestMap.values()].map(String)));
    if (ownItemIds.length > 0) {
      const ownRes = await client.query(
        `SELECT id, unit FROM items WHERE business_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
        [business_id, ownItemIds]
      );
      for (const row of ownRes.rows) ownItems.set(String(row.id), { id: String(row.id), unit: row.unit });
    }
    const resolvedLines: Array<{ itemId: string | null; unit: string | null }> = [];
    const unmatched: Array<{ invoice_item_id: string; item_name: string }> = [];
    for (const line of invoiceItems) {
      let match: { id: string; unit: string | null } | null = null;
      const explicit = explicitMap[String(line.id)];
      if (explicit) {
        match = ownItems.get(String(explicit)) ?? null;
        if (!match) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: `Item chosen for "${line.item_name}" was not found in your items`, code: 'ITEM_MAP_INVALID' },
            { status: 400 }
          );
        }
      }
      if (!match && line.item_id && requestMap.has(String(line.item_id))) {
        match = ownItems.get(requestMap.get(String(line.item_id))!) ?? null;
      }
      if (!match && line.item_name) {
        const byName = await client.query(
          `SELECT id, unit FROM items
            WHERE business_id = $1 AND deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER(TRIM($2))
            LIMIT 1`,
          [business_id, line.item_name]
        );
        if (byName.rows[0]) match = { id: String(byName.rows[0].id), unit: byName.rows[0].unit };
      }
      if (!match && line.vendor_item_type !== 'service') {
        unmatched.push({ invoice_item_id: String(line.id), item_name: line.item_name });
      }
      resolvedLines.push({ itemId: match?.id ?? null, unit: match?.unit ?? null });
    }
    if (unmatched.length > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: `Match these supplier items to your own items first: ${unmatched.map((u) => u.item_name).join(', ')}`,
          code: 'ITEMS_UNMATCHED',
          unmatched,
        },
        { status: 422 }
      );
    }

    // Tax split is copied from the supplier's invoice; POS is the one it declared, else the
    // receiving branch's own registration state (s.25(4): a branch GSTIN is a distinct person).
    const buyerReg = await resolveSupplierRegistration(client, business_id, purchaseBranchId);
    const sellerReg = await resolveSupplierRegistration(client, invoice.business_id, invoice.branch_id);
    if (sellerReg.gstin) invoice.supplier_gstin = sellerReg.gstin;
    const placeOfSupplyStateCode =
      (invoice.place_of_supply_state_code && String(invoice.place_of_supply_state_code).trim()) ||
      buyerReg.stateCode ||
      sellerReg.stateCode ||
      invoice.supplier_state_code ||
      '';

    // Create purchase
    // The seller's receipts are not the buyer's payments: the bill starts unpaid and payments
    // are recorded against it, so AP and the supplier balance carry the full amount.
    const grandTotal = Number(invoice.grand_total) || 0;
    const balanceAmount = grandTotal;
    const paymentStatus = balanceAmount <= 0 ? 'paid' : 'unpaid';
    const cessTotal = Math.round(
      invoiceItems.reduce((s: number, it: any) => s + (Number(it.cess_amount) || 0), 0) * 100
    ) / 100;
    
    const purchaseRes = await client.query(`
      INSERT INTO purchases (
        business_id, branch_id, supplier_id, bill_number, bill_date,
        status, subtotal, tax_total,
        grand_total, place_of_supply_state_code, supplier_gstin,
        cgst_total, sgst_total, igst_total, document_type,
        itc_eligible, notes, paid_amount, balance_amount, payment_status, cess_total,
        source_invoice_id, source_business_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      RETURNING *
    `, [
      business_id,
      purchaseBranchId,
      supplierId,
      invoice.invoice_number, // Use invoice number as bill number
      invoice.invoice_date,
      'final', // Converted invoices are immediately finalized
      invoice.subtotal || 0,
      invoice.tax_total || 0,
      invoice.grand_total || 0,
      placeOfSupplyStateCode,
      invoice.supplier_gstin || null,
      invoice.cgst_total || 0,
      invoice.sgst_total || 0,
      invoice.igst_total || 0,
      invoice.document_type || 'tax_invoice',
      true, // Default ITC eligible
      invoice.notes || null,
      0,
      balanceAmount,
      paymentStatus,
      cessTotal,
      invoiceId,
      invoice.business_id,
    ]);

    const purchase = purchaseRes.rows[0];

    // Create purchase items and update stock
    for (let i = 0; i < invoiceItems.length; i++) {
      const item = invoiceItems[i];
      
      // The supplier's item_id belongs to their business; use the caller's matched item.
      const customerItemId = resolvedLines[i].itemId;
      
      const locationIdForPurchase = warehouseModeEnabled ? defaultWarehouseId : null;

      await client.query(`
        INSERT INTO purchase_items (
          purchase_id, item_id, item_name, hsn_sac, quantity, unit, unit_price,
          discount_percent, discount_amount, tax_rate, tax_mode, tax_amount, taxable_value,
          cgst_amount, sgst_amount, igst_amount, line_total, location_id, cess_amount
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `, [
        purchase.id,
        customerItemId, // Use customer's item_id, not supplier's
        item.item_name,
        item.hsn_sac || null,
        item.quantity,
        resolvedLines[i].unit || item.unit || 'PCS',
        item.unit_price,
        item.discount_percent || 0,
        item.discount_amount || 0,
        item.tax_rate || 0,
        'exclusive',
        item.tax_amount || 0,
        item.taxable_value || 0,
        item.cgst_amount || 0,
        item.sgst_amount || 0,
        item.igst_amount || 0,
        item.line_total || 0,
        locationIdForPurchase,
        Number(item.cess_amount) || 0,
      ]);

      // Update stock if item was found in customer's inventory
      if (customerItemId && purchase.status === 'final') {
          // Check if item is goods (services don't update stock)
          let itemType = 'goods'; // Default to goods
          if (hasItemType) {
            const itemTypeRes = await client.query(
              'SELECT item_type FROM items WHERE id = $1',
              [customerItemId]
            );
            if (itemTypeRes.rows.length > 0) {
              itemType = itemTypeRes.rows[0].item_type || 'goods';
            }
          }
          
          if (itemType === 'goods') {
            const quantity = Number(item.quantity) || 0;
            const unitCost = Number(item.unit_price) || 0;
            
            // Check if item tracks batch/serial (if columns exist)
            let trackBatch = false;
            let trackSerial = false;
            
            if (hasTrackBatch || hasTrackSerial) {
              const selectFields = [];
              if (hasTrackBatch) selectFields.push('track_batch');
              if (hasTrackSerial) selectFields.push('track_serial');
              
              const trackRes = await client.query(
                `SELECT ${selectFields.join(', ')} FROM items WHERE id = $1`,
                [customerItemId]
              );
              const trackData = trackRes.rows[0] || {};
              trackBatch = trackData.track_batch || false;
              trackSerial = trackData.track_serial || false;
            }
            
            // If batch/serial tracking is enabled AND columns exist, use advanced inventory allocation
            if ((trackBatch || trackSerial) && (hasBatchId || hasSerialId)) {
              const allocation = await allocateStockOnPurchase(
                customerItemId,
                quantity,
                unitCost,
                business_id,
                purchase.id,
                locationIdForPurchase || undefined,
                supplierId || undefined,
                undefined, // batch_number
                undefined, // serial_numbers
                undefined, // manufacturing_date
                undefined  // expiry_date
              );
              
              // Create stock movement entries for batches if batch_id column exists
              if (allocation.batchId && hasBatchId) {
                const batchColumns = ['business_id', 'item_id', 'type', 'quantity', 'reference_type', 'reference_id', 'batch_id'];
                const batchValues = [business_id, customerItemId, 'in', quantity, 'purchase', purchase.id, allocation.batchId];
                
                if (hasUnitCost) {
                  batchColumns.push('unit_cost');
                  batchValues.push(unitCost);
                }
                batchColumns.push('notes');
                batchValues.push(`Purchase: ${purchase.bill_number || 'New'}`);
                
                const batchPlaceholders = batchValues.map((_, i) => `$${i + 1}`).join(', ');
                await client.query(
                  `INSERT INTO stock_movements (${batchColumns.join(', ')}) VALUES (${batchPlaceholders})`,
                  batchValues
                );
              }
              
              // Create stock movement entries for serials if serial_id column exists
              if (allocation.serialIds && allocation.serialIds.length > 0 && hasSerialId) {
                for (const serialId of allocation.serialIds) {
                  const serialColumns = ['business_id', 'item_id', 'type', 'quantity', 'reference_type', 'reference_id', 'serial_id'];
                  const serialValues = [business_id, customerItemId, 'in', 1, 'purchase', purchase.id, serialId];
                  
                  if (hasUnitCost) {
                    serialColumns.push('unit_cost');
                    serialValues.push(unitCost);
                  }
                  serialColumns.push('notes');
                  serialValues.push(`Purchase: ${purchase.bill_number || 'New'}`);
                  
                  const serialPlaceholders = serialValues.map((_, i) => `$${i + 1}`).join(', ');
                  await client.query(
                    `INSERT INTO stock_movements (${serialColumns.join(', ')}) VALUES (${serialPlaceholders})`,
                    serialValues
                  );
                }
              }
            }
            
            if (warehouseModeEnabled && locationIdForPurchase) {
              await client.query(
                `
                INSERT INTO location_stock (location_id, item_id, current_stock_qty)
                VALUES ($1, $2, $3)
                ON CONFLICT (location_id, item_id)
                DO UPDATE SET
                  current_stock_qty = location_stock.current_stock_qty + $3,
                  last_updated = CURRENT_TIMESTAMP
              `,
                [locationIdForPurchase, customerItemId, quantity]
              );
            } else if (!warehouseModeEnabled) {
              await adjustBranchItemStock(client, business_id, purchaseBranchId, customerItemId, quantity);
              await refreshItemGlobalStockFromBranches(client, business_id, customerItemId);
            } else {
              await client.query('ROLLBACK');
              return NextResponse.json(
                {
                  error:
                    'Warehouse mode is on but no stock location was applied for this line. Ensure default warehouse is set for the branch.',
                  code: 'WAREHOUSE_REQUIRED',
                },
                { status: 400 }
              );
            }

            if (!trackBatch && !trackSerial) {
              const simpleColumns = ['business_id', 'item_id', 'type', 'quantity', 'reference_type', 'reference_id'];
              const simpleValues = [business_id, customerItemId, 'in', quantity, 'purchase', purchase.id];

              if (hasUnitCost) {
                simpleColumns.push('unit_cost');
                simpleValues.push(unitCost);
              }
              simpleColumns.push('location_id');
              simpleValues.push(locationIdForPurchase);
              simpleColumns.push('notes');
              simpleValues.push(`Purchase: ${purchase.bill_number || 'New'}`);

              const simplePlaceholders = simpleValues.map((_, i) => `$${i + 1}`).join(', ');
              await client.query(
                `INSERT INTO stock_movements (${simpleColumns.join(', ')}) VALUES (${simplePlaceholders})`,
                simpleValues
              );
            }
          }
      } else if (!customerItemId) {
        console.warn(`[Convert Invoice] Cannot update stock - item not found in customer inventory: ${item.item_name}`);
      }
    }

    const invRes = await client.query(
      `SELECT COALESCE(SUM(pi.taxable_value::numeric), 0) AS total
         FROM purchase_items pi
         JOIN items i ON i.id = pi.item_id AND i.business_id = $2
        WHERE pi.purchase_id = $1 AND COALESCE(i.item_type, 'goods') = 'goods'`,
      [purchase.id, business_id]
    );
    const { createPurchaseLedgerEntries } = await import('@/lib/ledger-utils');
    await createPurchaseLedgerEntries({
      businessId: business_id,
      purchaseId: purchase.id,
      purchaseNumber: purchase.bill_number || String(purchase.id).substring(0, 8),
      purchaseDate: purchase.bill_date,
      grandTotal,
      supplierId,
      isCashPurchase: !supplierId,
      inventoryAmount: Number(invRes.rows[0]?.total) || 0,
      branchId: purchaseBranchId,
      poolClient: client,
      taxableValue: Number(invoice.subtotal) || 0,
      cgstTotal: Number(invoice.cgst_total) || 0,
      sgstTotal: Number(invoice.sgst_total) || 0,
      igstTotal: Number(invoice.igst_total) || 0,
      cessTotal,
      itcEligible: true,
      isReverseCharge: false,
    });
    if (supplierId && balanceAmount !== 0) {
      await client.query(
        `UPDATE suppliers SET current_balance = COALESCE(current_balance, 0) + $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND business_id = $3`,
        [balanceAmount, supplierId, business_id]
      );
    }

    // Link purchase to quantity request if invoice was linked to a request
    if (linkedRequests.length > 0) {
      await client.query(`
        UPDATE quantity_requests
        SET purchase_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ANY($2::uuid[])
      `, [purchase.id, linkedRequests.map((r: any) => r.id)]);
    }

    await client.query('COMMIT');

    return NextResponse.json({ purchase }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error converting invoice to purchase:', error);
    return NextResponse.json(
      { error: 'Failed to convert invoice to purchase', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
