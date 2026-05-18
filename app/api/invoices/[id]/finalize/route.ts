import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows, query, getPool } from '@/lib/db';
import { getFirstBundleStockPreflightFailure } from '@/lib/invoice-bundle-stock';
import { allocateStockOnSale } from '@/lib/stock-valuation';
import { FeatureKeys } from '@/lib/featureKeys';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getBusinessIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { adjustBranchVariantStock, refreshVariantGlobalStockFromBranches } from '@/lib/branch-variant-stock';
import {
  deductBundleChildrenOnInvoice,
  InvoiceBundleStockError,
  type BundleDeductionContext,
} from '@/lib/invoice-bundle-stock';

async function fetchInvoiceWithItems(id: string, businessId: string) {
  const invoice = await queryOne(
    `SELECT * FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [id, businessId]
  );
  if (!invoice) return null;
  const items = await queryRows(
    `SELECT * FROM invoice_items WHERE invoice_id = $1`,
    [id]
  );
  return { invoice, items };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = params.id;

  const body = await request.json().catch(() => ({}));
  const businessScope =
    getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request, body);
  if (!businessScope) {
    return NextResponse.json(
      { error: 'business_id is required' },
      { status: 400 }
    );
  }

  const current = await fetchInvoiceWithItems(id, businessScope);
  if (!current) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }
  const inv = current.invoice;

  if (!inv.branch_id) {
    return NextResponse.json(
      { error: 'Invoice is missing branch_id; cannot finalize stock.', code: 'BRANCH_REQUIRED' },
      { status: 400 }
    );
  }
  const stockBranchId = inv.branch_id as string;

  // Get user_id from request body
  const userId = body.user_id || body.updated_by;
  
  if (!userId) {
    return NextResponse.json(
      { error: 'user_id is required for authorization' },
      { status: 400 }
    );
  }

  // AUTHORIZATION: Check finalize permission (PBAC will check status, period lock, etc.)
  try {
    await authorize(userId, 'invoices', 'finalize', { 
      branchId: inv.branch_id,
      businessId: inv.business_id,
      resourceId: id,
      invoice_date: inv.invoice_date,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    throw error;
  }

  // If already final, return early (policy already checked this)
  if (inv.status === 'final') {
    return NextResponse.json({ invoice: inv });
  }

  // Preflight: bundle component stock before opening the stock transaction
  {
    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeFinalize = await isWarehouseModeEnabled(inv.business_id);
    const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');

    for (const row of current.items) {
      if (!row.item_id) continue;
      const head = await queryOne<{ is_bundle: boolean; item_type: string }>(
        `SELECT COALESCE(is_bundle, false) AS is_bundle, item_type FROM items WHERE id = $1 AND business_id = $2`,
        [row.item_id, inv.business_id]
      );
      if (!head || head.item_type !== 'goods' || !head.is_bundle) continue;

      let warehouseId: string | null | undefined = row.location_id;
      if (warehouseModeFinalize && !warehouseId) {
        warehouseId = await getDefaultWarehouseForBranch(stockBranchId);
      }
      if (warehouseModeFinalize && !warehouseId) {
        return NextResponse.json(
          {
            error: `location_id (warehouse) is required for bundle "${row.item_name || row.item_id}". Warehouse mode is enabled.`,
            item_id: row.item_id,
            code: 'WAREHOUSE_REQUIRED',
          },
          { status: 400 }
        );
      }

      const bundlePreflightFail = await getFirstBundleStockPreflightFailure({
        businessId: inv.business_id,
        branchId: stockBranchId,
        bundleItemId: row.item_id,
        lineQuantity: Number(row.quantity) || 0,
        warehouseModeEnabled: warehouseModeFinalize,
        warehouseId: warehouseId || null,
      });
      if (bundlePreflightFail) {
        return NextResponse.json(
          {
            error: `Insufficient stock for component: ${bundlePreflightFail.name}`,
            item_name: bundlePreflightFail.name,
            item_id: bundlePreflightFail.itemId,
            available_stock: bundlePreflightFail.available,
            requested_quantity: bundlePreflightFail.need,
          },
          { status: 400 }
        );
      }
    }
  }

  // CRITICAL: Only check limit if finalizing a draft (not already final)
  // If already final, no limit check needed (already counted)
  // Deduct stock with batch/serial tracking support
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    try {
      await enforceAccess({
        businessId: inv.business_id,
        userId,
        branchId: stockBranchId,
        feature: FeatureKeys.INVOICE_CREATION,
        limitType: 'invoices',
        poolClient: client,
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) {
        await client.query('ROLLBACK');
        client.release();
        return res;
      }
      throw e;
    }

    // CREDIT LIMIT ENFORCEMENT: Check credit limit before finalizing invoice
    // Only applies to sales invoices (not proforma) with customer
    if (inv.customer_id && inv.document_type !== 'proforma_invoice') {
      // Fetch customer credit limit and current balance
      const customerData = await client.query(
        `SELECT credit_limit, current_balance FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
        [inv.customer_id, inv.business_id]
      );

      if (customerData.rows.length > 0) {
        const creditLimit = parseFloat(customerData.rows[0].credit_limit ?? '0');
        const currentBalance = parseFloat(customerData.rows[0].current_balance ?? '0');
        
        // Calculate new invoice amount (balance after any payments)
        // Use ?? instead of || to avoid treating 0 as falsy
        const invoiceBalance = inv.balance_amount ?? (parseFloat(inv.grand_total ?? '0') - parseFloat(inv.paid_amount ?? '0'));
        const newTotalBalance = currentBalance + invoiceBalance;

        // Only enforce if credit_limit > 0 (0 means unlimited credit)
        if (creditLimit > 0 && newTotalBalance > creditLimit) {
          // PHASE 5.3: Check for approved credit approval
          const approvalCheck = await client.query(
            `SELECT id, status FROM credit_approvals
             WHERE business_id = $1 AND reference_type = 'invoice' AND reference_id = $2 AND status = 'approved'`,
            [inv.business_id, id]
          );

          if (approvalCheck.rows.length === 0) {
            // No approved override - block finalization
            const availableCredit = Math.max(0, creditLimit - currentBalance);
            await client.query('ROLLBACK');
            client.release();
            return NextResponse.json(
              {
                error: `Credit limit exceeded. Approval required. Available credit: ₹${availableCredit.toFixed(2)}`,
                code: 'CREDIT_LIMIT_EXCEEDED',
                credit_limit: creditLimit,
                current_balance: currentBalance,
                new_invoice_amount: invoiceBalance,
                would_exceed_by: newTotalBalance - creditLimit,
                available_credit: availableCredit,
                requires_approval: true
              },
              { status: 400 }
            );
          }
          // Approved override exists - allow finalization
        }
      }
    }

    // CRITICAL: Validate warehouse-branch relationships before stock deduction
    const { isWarehouseAccessibleByBranch } = await import('@/lib/warehouse-access');
    
    // PBAC: Check warehouse access for each item (if warehouse mode enabled)
    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(inv.business_id);
    
    for (const row of current.items) {
      if (!row.item_id) continue;
      
      // Validate warehouse is accessible by branch (if warehouse_id provided)
      if (row.location_id) {
        const isAccessible = await isWarehouseAccessibleByBranch(row.location_id, inv.branch_id);
        if (!isAccessible) {
          await client.query('ROLLBACK');
          client.release();
          return NextResponse.json(
            { 
              error: `Warehouse ${row.location_id} is not accessible by branch ${inv.branch_id}. Cannot finalize invoice.`,
              item_name: row.item_name || 'Unknown item',
              warehouse_id: row.location_id
            },
            { status: 400 }
          );
        }
        
        // PBAC: Check user warehouse access
        if (warehouseModeEnabled && userId) {
          const { checkUserWarehouseAccess } = await import('@/lib/warehouse-access');
          const warehouseAccess = await checkUserWarehouseAccess(userId, row.location_id);
          
          if (!warehouseAccess?.can_create_transactions) {
            await client.query('ROLLBACK');
            client.release();
            return NextResponse.json(
              { 
                error: `No access to warehouse. You do not have permission to finalize transactions in warehouse for item "${row.item_name || row.item_id}".`,
                item_id: row.item_id,
                item_name: row.item_name,
                warehouse_id: row.location_id,
                code: 'WAREHOUSE_ACCESS_DENIED'
              },
              { status: 403 }
            );
          }
        }
      }
      
      // Check if item is goods (services don't update stock)
      const itemTypeRes = await client.query(
        `SELECT item_type, track_batch, track_serial, valuation_method,
                COALESCE(is_bundle, false) AS is_bundle
         FROM items WHERE id = $1`,
        [row.item_id]
      );
      const itemData = itemTypeRes.rows[0];
      const itemType = itemData?.item_type || 'goods';

      if (itemType === 'goods') {
        const trackBatch = itemData?.track_batch || false;
        const trackSerial = itemData?.track_serial || false;
        const valuationMethod = (itemData?.valuation_method || 'simple') as 'fifo' | 'lifo' | 'weighted_avg' | 'simple';
        const quantity = Number(row.quantity) || 0;

        if (itemData?.is_bundle) {
          if (row.variant_id) {
            await client.query('ROLLBACK');
            client.release();
            return NextResponse.json(
              {
                error: 'Bundle items cannot have a variant on the invoice line.',
                item_id: row.item_id,
                code: 'BUNDLE_VARIANT_NOT_ALLOWED',
              },
              { status: 400 }
            );
          }
          const bundleCtx: BundleDeductionContext = {
            client,
            businessId: inv.business_id,
            branchId: stockBranchId,
            invoiceId: inv.id,
            customerId: inv.customer_id || null,
            warehouseModeEnabled,
            hasBatchTrackingColumns: true,
          };
          try {
            await deductBundleChildrenOnInvoice(
              bundleCtx,
              row.item_id,
              quantity,
              row.location_id || null,
              row.item_name || row.item_id
            );
          } catch (e) {
            if (e instanceof InvoiceBundleStockError) {
              await client.query('ROLLBACK');
              client.release();
              return NextResponse.json(e.body, { status: e.statusCode });
            }
            throw e;
          }
          continue;
        }

        // Handle variant stock
        if (row.variant_id) {
          const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
          const warehouseModeEnabled = await isWarehouseModeEnabled(inv.business_id);

          if (warehouseModeEnabled) {
            if (!row.location_id) {
              await client.query('ROLLBACK');
              client.release();
              return NextResponse.json(
                {
                  error: `location_id (warehouse) is required for variant line "${row.item_name || row.item_id}".`,
                  item_id: row.item_id,
                  code: 'WAREHOUSE_REQUIRED',
                },
                { status: 400 }
              );
            }
            await client.query(
              `SELECT * FROM location_stock WHERE location_id = $1 AND item_id = $2 FOR UPDATE`,
              [row.location_id, row.item_id]
            );
            await client.query(
              `UPDATE location_stock
               SET current_stock_qty = current_stock_qty - $1,
                   last_updated = CURRENT_TIMESTAMP
               WHERE location_id = $2 AND item_id = $3`,
              [quantity, row.location_id, row.item_id]
            );
          } else {
            await adjustBranchVariantStock(client, inv.business_id, stockBranchId, row.variant_id, -quantity);
            await refreshVariantGlobalStockFromBranches(client, inv.business_id, row.variant_id);
          }

          const variantRes = await client.query(
            `SELECT iv.*, i.track_batch, i.track_serial, i.valuation_method 
             FROM item_variants iv
             JOIN items i ON iv.item_id = i.id
             WHERE iv.id = $1`,
            [row.variant_id]
          );
          const variantData = variantRes.rows[0];
          const variantTrackBatch = variantData?.track_batch || false;
          const variantTrackSerial = variantData?.track_serial || false;
          const variantValuationMethod = (variantData?.valuation_method || 'simple') as 'fifo' | 'lifo' | 'weighted_avg' | 'simple';

          if (variantTrackBatch || variantTrackSerial) {
            try {
              const allocation = await allocateStockOnSale(
                row.item_id,
                quantity,
                variantValuationMethod,
                inv.business_id,
                row.location_id || undefined,
                variantTrackSerial,
                row.variant_id
              );

              for (const batchAlloc of allocation.batchAllocations) {
                await client.query(
                  `
                  UPDATE item_batches
                  SET quantity = quantity - $1,
                      updated_at = CURRENT_TIMESTAMP
                  WHERE id = $2
                `,
                  [batchAlloc.quantity, batchAlloc.batch_id]
                );

                await client.query(
                  `
                  INSERT INTO stock_movements (
                    business_id, item_id, variant_id, type, quantity,
                    reference_type, reference_id, batch_id, unit_cost
                  )
                  VALUES ($1, $2, $3, 'out', $4, 'invoice', $5, $6, $7)
                `,
                  [
                    inv.business_id,
                    row.item_id,
                    row.variant_id,
                    batchAlloc.quantity,
                    inv.id,
                    batchAlloc.batch_id,
                    batchAlloc.unit_cost,
                  ]
                );
              }

              if (allocation.serialAllocations) {
                for (const serialAlloc of allocation.serialAllocations) {
                  await client.query(
                    `
                    UPDATE item_serials
                    SET status = 'sold',
                        sold_to_customer_id = $1,
                        sold_invoice_id = $2,
                        sold_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $3
                  `,
                    [inv.customer_id || null, inv.id, serialAlloc.serial_id]
                  );

                  await client.query(
                    `
                    INSERT INTO stock_movements (
                      business_id, item_id, variant_id, type, quantity,
                      reference_type, reference_id, serial_id, unit_cost
                    )
                    VALUES ($1, $2, $3, 'out', 1, 'invoice', $4, $5, $6)
                  `,
                    [
                      inv.business_id,
                      row.item_id,
                      row.variant_id,
                      inv.id,
                      serialAlloc.serial_id,
                      serialAlloc.unit_cost,
                    ]
                  );
                }
              }
            } catch (allocationError: any) {
              console.error('Error allocating variant stock on finalize:', allocationError);
              await client.query(
                `
                INSERT INTO stock_movements (
                  business_id, item_id, variant_id, location_id, type, quantity, reference_type, reference_id
                )
                VALUES ($1, $2, $3, $4, 'out', $5, 'invoice', $6)
              `,
                [inv.business_id, row.item_id, row.variant_id, row.location_id || null, quantity, inv.id]
              );
            }
          } else {
            await client.query(
              `
              INSERT INTO stock_movements (
                business_id, item_id, variant_id, location_id, type, quantity, reference_type, reference_id
              )
              VALUES ($1, $2, $3, $4, 'out', $5, 'invoice', $6)
            `,
              [inv.business_id, row.item_id, row.variant_id, row.location_id || null, quantity, inv.id]
            );
          }
        } else {
          // No variant - handle item-level stock
          // Check if warehouse mode is enabled
          const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
          const warehouseModeEnabled = await isWarehouseModeEnabled(inv.business_id);
          
          // CRITICAL: location_id is MANDATORY when warehouse mode is enabled
          if (warehouseModeEnabled && !row.location_id) {
            await client.query('ROLLBACK');
            client.release();
            return NextResponse.json(
              { 
                error: `location_id (warehouse) is required for item "${row.item_name || row.item_id}". Warehouse mode is enabled - stock operations require warehouse context.`,
                item_id: row.item_id,
                item_name: row.item_name,
                code: 'WAREHOUSE_REQUIRED'
              },
              { status: 400 }
            );
          }
          
          const locationId = row.location_id || null;
          
          if (trackBatch || trackSerial) {
            try {
              const allocation = await allocateStockOnSale(
                row.item_id,
                quantity,
                valuationMethod,
                inv.business_id,
                locationId || undefined,
                trackSerial
              );

              // Update stock - conditional based on warehouse mode
              if (warehouseModeEnabled && locationId) {
                // Warehouse mode: use location_stock
                // Lock location stock for update
                await client.query(`
                  SELECT * FROM location_stock 
                  WHERE location_id = $1 AND item_id = $2
                  FOR UPDATE
                `, [locationId, row.item_id]);

                // Update location_stock
                await client.query(`
                  UPDATE location_stock
                  SET current_stock_qty = current_stock_qty - $1,
                      last_updated = CURRENT_TIMESTAMP
                  WHERE location_id = $2 AND item_id = $3
                `, [quantity, locationId, row.item_id]);
              } else if (!warehouseModeEnabled) {
                await adjustBranchItemStock(client, inv.business_id, stockBranchId, row.item_id, -quantity);
                await refreshItemGlobalStockFromBranches(client, inv.business_id, row.item_id);
              }

              for (const batchAlloc of allocation.batchAllocations) {
                await client.query(`
                  UPDATE item_batches
                  SET quantity = quantity - $1,
                      updated_at = CURRENT_TIMESTAMP
                  WHERE id = $2
                `, [batchAlloc.quantity, batchAlloc.batch_id]);

                await client.query(`
                  INSERT INTO stock_movements (
                    business_id, item_id, location_id, type, quantity,
                    reference_type, reference_id, batch_id, unit_cost
                  )
                  VALUES ($1, $2, $3, 'out', $4, 'invoice', $5, $6, $7)
                `, [
                  inv.business_id,
                  row.item_id,
                  locationId,
                  batchAlloc.quantity,
                  inv.id,
                  batchAlloc.batch_id,
                  batchAlloc.unit_cost
                ]);
              }

              if (allocation.serialAllocations) {
                for (const serialAlloc of allocation.serialAllocations) {
                  await client.query(`
                    UPDATE item_serials
                    SET status = 'sold',
                        sold_to_customer_id = $1,
                        sold_invoice_id = $2,
                        sold_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $3
                  `, [inv.customer_id || null, inv.id, serialAlloc.serial_id]);

                  await client.query(`
                    INSERT INTO stock_movements (
                      business_id, item_id, location_id, type, quantity,
                      reference_type, reference_id, serial_id, unit_cost
                    )
                    VALUES ($1, $2, $3, 'out', 1, 'invoice', $4, $5, $6)
                  `, [
                    inv.business_id,
                    row.item_id,
                    locationId,
                    inv.id,
                    serialAlloc.serial_id,
                    serialAlloc.unit_cost
                  ]);
                }
              }
            } catch (allocationError: any) {
              console.error('Error allocating stock on finalize:', allocationError);
              // Fallback stock update - conditional based on warehouse mode
              if (warehouseModeEnabled && locationId) {
                // Warehouse mode: use location_stock
                await client.query(`
                  UPDATE location_stock
                  SET current_stock_qty = current_stock_qty - $1,
                      last_updated = CURRENT_TIMESTAMP
                  WHERE location_id = $2 AND item_id = $3
                `, [quantity, locationId, row.item_id]);
              } else if (!warehouseModeEnabled) {
                await adjustBranchItemStock(client, inv.business_id, stockBranchId, row.item_id, -quantity);
                await refreshItemGlobalStockFromBranches(client, inv.business_id, row.item_id);
              }

              await client.query(`
                INSERT INTO stock_movements (
                  business_id, item_id, location_id, type, quantity, reference_type, reference_id
                )
                VALUES ($1, $2, $3, 'out', $4, 'invoice', $5)
              `, [inv.business_id, row.item_id, locationId, quantity, inv.id]);
            }
          } else {
            // Simple stock update - conditional based on warehouse mode
            if (warehouseModeEnabled && locationId) {
              // Warehouse mode: use location_stock
              // Lock location stock for update
              await client.query(`
                SELECT * FROM location_stock 
                WHERE location_id = $1 AND item_id = $2
                FOR UPDATE
              `, [locationId, row.item_id]);

              // Update location_stock
              await client.query(`
                UPDATE location_stock
                SET current_stock_qty = current_stock_qty - $1,
                    last_updated = CURRENT_TIMESTAMP
                WHERE location_id = $2 AND item_id = $3
              `, [quantity, locationId, row.item_id]);
            } else if (!warehouseModeEnabled) {
              await adjustBranchItemStock(client, inv.business_id, stockBranchId, row.item_id, -quantity);
              await refreshItemGlobalStockFromBranches(client, inv.business_id, row.item_id);
            }

            await client.query(`
              INSERT INTO stock_movements (
                business_id, item_id, location_id, type, quantity, reference_type, reference_id
              )
              VALUES ($1, $2, $3, 'out', $4, 'invoice', $5)
            `, [inv.business_id, row.item_id, locationId, quantity, inv.id]);
          }
        }
      }
    }

    await client.query('COMMIT');
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const updated = await queryOne(
    `UPDATE invoices
     SET status = 'final', is_editable = false, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [id, businessScope]
  );

  if (updated) {
    try {
      const { ensureInvoicePublicToken } = await import('@/lib/customer-surface');
      await ensureInvoicePublicToken(id);
    } catch (tokenErr) {
      console.error('[finalize] public token assignment failed (non-fatal):', tokenErr);
    }
  }

  return NextResponse.json({ invoice: updated });
}


