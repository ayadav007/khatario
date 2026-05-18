import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { allocateStockOnPurchase } from '@/lib/stock-valuation';
import { resolveBranchId } from '@/lib/branch-helpers';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';

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
    const { business_id, branch_id: bodyBranchId } = body;
    
    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    
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

    // Fetch invoice with items
    const invoiceRes = await client.query(`
      SELECT 
        i.*,
        c.id as customer_id,
        c.name as customer_name,
        b.id as supplier_business_id,
        b.name as supplier_business_name,
        b.state as supplier_state,
        b.state_code as supplier_state_code,
        b.gstin as supplier_gstin
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
      LEFT JOIN businesses b ON i.business_id = b.id
      WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL
    `, [invoiceId, business_id]);

    if (invoiceRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const invoice = invoiceRes.rows[0];
    
    // Verify access: Multiple ways to allow conversion:
    // 1. Invoice is linked to a request where current business is the requester
    // 2. Invoice is from a supplier (business) that we have a supplier relationship with
    // 3. Customer in the invoice belongs to current business (legacy check)
    
    const requestRes = await client.query(`
      SELECT requester_business_id, responder_business_id 
      FROM quantity_requests 
      WHERE invoice_id = $1 
      LIMIT 1
    `, [invoiceId]);
    
    let hasAccess = false;
    let accessReason = '';
    
    if (requestRes.rows.length > 0) {
      // Invoice is linked to a request - verify current business is the requester
      hasAccess = requestRes.rows[0].requester_business_id === business_id;
      if (hasAccess) {
        accessReason = 'linked to request';
      }
    }
    
    // If not linked to request, check if we have a supplier relationship with the invoice's business
    if (!hasAccess && invoice.supplier_business_id) {
      const supplierCheckRes = await client.query(`
        SELECT s.id, s.linked_business_id, s.name
        FROM suppliers s
        WHERE s.business_id = $1 
        AND s.linked_business_id = $2
        LIMIT 1
      `, [business_id, invoice.supplier_business_id]);
      
      if (supplierCheckRes.rows.length > 0) {
        // We have a supplier relationship with the invoice's business
        hasAccess = true;
        accessReason = 'supplier relationship';
      }
    }
    
    // Fallback: Check if customer belongs to current business (legacy)
    if (!hasAccess && invoice.customer_id) {
      const customerRes = await client.query(`
        SELECT business_id FROM customers WHERE id = $1 AND deleted_at IS NULL
      `, [invoice.customer_id]);
      hasAccess = customerRes.rows.length > 0 && customerRes.rows[0].business_id === business_id;
      if (hasAccess) {
        accessReason = 'customer belongs to business';
      }
    }
    
    if (!hasAccess) {
      await client.query('ROLLBACK');
      console.error('[Convert Invoice] Access denied:', {
        invoiceId,
        business_id,
        invoice_business_id: invoice.supplier_business_id,
        hasRequestLink: requestRes.rows.length > 0,
        requestRequester: requestRes.rows[0]?.requester_business_id,
        customer_id: invoice.customer_id
      });
      return NextResponse.json({ 
        error: 'You can only convert invoices that are linked to your requests or from your suppliers' 
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

    // Check if already converted
    const existingPurchaseRes = await client.query(`
      SELECT id FROM purchases 
      WHERE business_id = $1 
      AND bill_number = $2
      LIMIT 1
    `, [business_id, invoice.invoice_number]);
    
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
      SELECT * FROM invoice_items
      WHERE invoice_id = $1
      ORDER BY sort_order ASC
    `, [invoiceId]);

    const invoiceItems = itemsRes.rows;

    if (invoiceItems.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Invoice has no items' }, { status: 400 });
    }

    // Find or create supplier
    let supplierId: string | null = null;
    if (invoice.supplier_business_id) {
      // Try to find existing supplier by linked_business_id
      const supplierRes = await client.query(`
        SELECT id FROM suppliers 
        WHERE business_id = $1 
        AND linked_business_id = $2
        LIMIT 1
      `, [business_id, invoice.supplier_business_id]);
      
      if (supplierRes.rows.length > 0) {
        supplierId = supplierRes.rows[0].id;
      } else {
        // Create supplier from business details
        const newSupplierRes = await client.query(`
          INSERT INTO suppliers (
            business_id, name, phone, email, address, city, state, pincode, gstin,
            linked_business_id, approval_status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'approved')
          RETURNING id
        `, [
          business_id,
          invoice.supplier_business_name || 'Supplier',
          null, // Phone not available from business
          null, // Email not available from business
          null, // Address not available from business
          null, // City not available from business
          invoice.supplier_state || null,
          null, // Pincode not available from business
          invoice.supplier_gstin || null,
          invoice.supplier_business_id
        ]);
        supplierId = newSupplierRes.rows[0].id;
      }
    }

    // Calculate place of supply
    const businessRes = await client.query(`
      SELECT state, state_code FROM businesses WHERE id = $1
    `, [business_id]);
    const business = businessRes.rows[0];
    const businessStateCode = business?.state_code || '';
    const supplierStateCode = invoice.supplier_state_code || '';
    const placeOfSupplyStateCode = supplierStateCode && supplierStateCode === businessStateCode 
      ? businessStateCode 
      : (supplierStateCode || businessStateCode);

    // Create purchase
    // Note: purchases table has balance_amount and payment_status (from migration 017) but NOT discount_total
    const balanceAmount = (invoice.grand_total || 0) - (invoice.paid_amount || 0);
    const paymentStatus = balanceAmount <= 0 ? 'paid' : (invoice.paid_amount > 0 ? 'partially_paid' : 'unpaid');
    
    const purchaseRes = await client.query(`
      INSERT INTO purchases (
        business_id, branch_id, supplier_id, bill_number, bill_date,
        status, subtotal, tax_total,
        grand_total, place_of_supply_state_code, supplier_gstin,
        cgst_total, sgst_total, igst_total, document_type,
        itc_eligible, notes, paid_amount, balance_amount, payment_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
      invoice.paid_amount || 0,
      balanceAmount,
      paymentStatus
    ]);

    const purchase = purchaseRes.rows[0];

    // Create purchase items and update stock
    for (let i = 0; i < invoiceItems.length; i++) {
      const item = invoiceItems[i];
      
      // CRITICAL: Find the matching item in the customer's business inventory
      // The item_id from the invoice belongs to the supplier's business,
      // we need to find the matching item in the customer's business
      let customerItemId: string | null = null;
      
      if (item.item_name) {
        const itemSearchRes = await client.query(`
          SELECT id FROM items 
          WHERE business_id = $1 
          AND LOWER(TRIM(name)) = LOWER(TRIM($2))
          LIMIT 1
        `, [business_id, item.item_name]);
        
        if (itemSearchRes.rows.length > 0) {
          customerItemId = itemSearchRes.rows[0].id;
          console.log(`[Convert Invoice] Found matching item in customer inventory: ${item.item_name} -> ${customerItemId}`);
        } else {
          console.warn(`[Convert Invoice] No matching item found in customer inventory for: ${item.item_name}`);
        }
      }
      
      const locationIdForPurchase = warehouseModeEnabled ? defaultWarehouseId : null;

      await client.query(`
        INSERT INTO purchase_items (
          purchase_id, item_id, item_name, hsn_sac, quantity, unit, unit_price,
          discount_percent, discount_amount, tax_rate, tax_mode, tax_amount, taxable_value,
          cgst_amount, sgst_amount, igst_amount, line_total, location_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `, [
        purchase.id,
        customerItemId, // Use customer's item_id, not supplier's
        item.item_name,
        item.hsn_sac || null,
        item.quantity,
        'PCS',
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

    // Link purchase to quantity request if invoice was linked to a request
    // (requestRes was already fetched above for access verification)
    if (requestRes.rows.length > 0) {
      await client.query(`
        UPDATE quantity_requests
        SET purchase_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE invoice_id = $2
      `, [purchase.id, invoiceId]);
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
