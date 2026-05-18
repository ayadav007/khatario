import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { calculateCreditMetrics, getCreditWarningMessage } from '@/lib/credit-utils';
import { checkAndSendCreditAlerts } from '@/lib/credit-alerts';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { adjustBranchVariantStock, refreshVariantGlobalStockFromBranches } from '@/lib/branch-variant-stock';
import { resolveBranchId } from '@/lib/branch-helpers';
import { shouldUseSoftDelete } from '@/lib/soft-delete-entitlements';

/**
 * GET /api/purchases/[id]
 * Fetch a single purchase with its items
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const purchaseId = params.id;

  try {
    // Get user_id from query params (required for authorization)
    const userId = getUserIdFromRequest(request);
    
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const businessScope = getBusinessIdFromRequest(request);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Tenant-scoped: only rows for JWT/session active business
    const purchaseResult = await pool.query(
      `SELECT 
        p.*,
        s.name as supplier_name,
        s.phone as supplier_phone,
        s.gstin as supplier_gstin
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.id = $1 AND p.business_id = $2 AND p.deleted_at IS NULL`,
      [purchaseId, businessScope]
    );

    if (purchaseResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Purchase not found' },
        { status: 404 }
      );
    }

    const purchase = purchaseResult.rows[0];

    // AUTHORIZATION: Check read permission with branch context
    try {
      await authorize(userId, 'purchases', 'read', { 
        branchId: purchase.branch_id,
        businessId: purchase.business_id,
        resourceId: purchaseId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Fetch purchase items
    const itemsResult = await pool.query(
      `SELECT
        pi.*,
        i.name AS catalog_item_name,
        i.code AS catalog_item_code
      FROM purchase_items pi
      LEFT JOIN items i ON pi.item_id = i.id
      WHERE pi.purchase_id = $1
      ORDER BY pi.id`,
      [purchaseId]
    );

    purchase.items = itemsResult.rows;

    // PHASE 4.3: Calculate credit metrics for supplier (if applicable)
    let creditMetrics = null;
    let creditWarning = null;
    
    if (purchase.supplier_id) {
      try {
        const supplierData = await pool.query(
          `SELECT credit_limit, current_balance FROM suppliers WHERE id = $1 AND business_id = $2`,
          [purchase.supplier_id, purchase.business_id]
        );

        if (supplierData.rows.length > 0) {
          const creditLimit = supplierData.rows[0].credit_limit;
          const currentBalance = supplierData.rows[0].current_balance;
          
          // Calculate current credit metrics
          const currentMetrics = calculateCreditMetrics(creditLimit, currentBalance);
          
          creditMetrics = {
            current: currentMetrics,
          };
          
          // Get warning message
          creditWarning = getCreditWarningMessage(
            currentMetrics,
            'supplier'
          );

          // PHASE 5.4: Check and send credit alerts (async, non-blocking)
          checkAndSendCreditAlerts(
            purchase.business_id,
            'supplier',
            purchase.supplier_id,
            creditLimit,
            currentBalance,
            currentMetrics,
            'purchase',
            purchase.id
          ).catch(err => console.error('Error sending credit alert:', err));
        }
      } catch (creditError) {
        // Don't fail purchase fetch if credit calculation fails
        console.error('Error calculating credit metrics:', creditError);
      }
    }

    return NextResponse.json({ 
      purchase,
      credit_metrics: creditMetrics,
      credit_warning: creditWarning,
    });
  } catch (error: any) {
    console.error('Error fetching purchase:', error);
    return NextResponse.json(
      { error: 'Failed to fetch purchase', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/purchases/[id]
 * Delete a purchase (only drafts, or final purchases with stock reversal)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const purchaseId = params.id;

  try {
    // Get user_id from request body or query params
    let body: Record<string, unknown> | undefined;
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
    const userId =
      getUserIdFromRequest(request, body) ||
      (body && ((body.deleted_by as string) || undefined));
    
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const businessScope = getBusinessIdFromRequest(request, body);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      // Check which columns exist in stock_movements table BEFORE starting transaction
      const columnsCheck = await client.query(
        `SELECT column_name 
         FROM information_schema.columns 
         WHERE table_name = 'stock_movements' 
         AND column_name IN ('unit_cost', 'batch_id', 'serial_id', 'location_id', 'variant_id')`
      );
      
      const availableColumns = new Set(columnsCheck.rows.map(row => row.column_name));
      const hasUnitCost = availableColumns.has('unit_cost');
      const hasBatchId = availableColumns.has('batch_id');
      const hasSerialId = availableColumns.has('serial_id');
      const hasLocationId = availableColumns.has('location_id');
      const hasVariantId = availableColumns.has('variant_id');

      const useSoftDeletePurchase = await shouldUseSoftDelete(businessScope);
      
      await client.query('BEGIN');

      // Fetch purchase details
      const purchaseResult = await client.query(
        `SELECT p.*, s.name as supplier_name
         FROM purchases p
         LEFT JOIN suppliers s ON p.supplier_id = s.id
         WHERE p.id = $1 AND p.business_id = $2 AND p.deleted_at IS NULL`,
        [purchaseId, businessScope]
      );

      if (purchaseResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Purchase not found' },
          { status: 404 }
        );
      }

      const purchase = purchaseResult.rows[0];

      const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
      const warehouseModeEnabled = await isWarehouseModeEnabled(purchase.business_id);
      let stockBranchId: string;
      try {
        stockBranchId = await resolveBranchId({
          businessId: purchase.business_id,
          branchId: purchase.branch_id,
        });
      } catch (e: any) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: e?.message || 'Purchase has no valid branch for stock reversal' },
          { status: 400 }
        );
      }

      // AUTHORIZATION: Check delete permission
      try {
        await authorize(userId, 'purchases', 'delete', {
          businessId: purchase.business_id,
          branchId: purchase.branch_id,
          resourceId: purchaseId,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        if (error instanceof AuthorizationError) {
          return error.toNextResponse();
        }
        throw error;
      }

      // Check for purchase returns
      const returnsCheck = await client.query(
        `SELECT COUNT(*) as count FROM purchase_returns WHERE purchase_id = $1`,
        [purchaseId]
      );

      if (parseInt(returnsCheck.rows[0].count) > 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Cannot delete purchase that has associated returns. Please delete the returns first.' },
          { status: 400 }
        );
      }

      // If purchase is final, reverse stock movements
      if (purchase.status === 'final') {
        // Fetch purchase items
        const itemsResult = await client.query(
          `SELECT item_id, quantity, unit_price
           FROM purchase_items
           WHERE purchase_id = $1 AND item_id IS NOT NULL`,
          [purchaseId]
        );

        // Reverse stock for each item
        for (const item of itemsResult.rows) {
          const purchaseQuantity = parseFloat(item.quantity.toString());
          
          // Build SELECT query based on available columns
          let selectColumns = ['id', 'quantity'];
          if (hasUnitCost) selectColumns.push('unit_cost');
          if (hasBatchId) selectColumns.push('batch_id');
          if (hasSerialId) selectColumns.push('serial_id');
          if (hasLocationId) selectColumns.push('location_id');
          if (hasVariantId) selectColumns.push('variant_id');
          
          // Get stock movements for this purchase
          const stockMovements = await client.query(
            `SELECT ${selectColumns.join(', ')}
             FROM stock_movements
             WHERE reference_type = 'purchase' AND reference_id = $1 AND item_id = $2`,
            [purchaseId, item.item_id]
          );

          // Reverse stock by processing stock movements
          for (const movement of stockMovements.rows) {
            const movementQty = parseFloat(movement.quantity.toString());
            
            if (hasVariantId && movement.variant_id) {
              if (warehouseModeEnabled && hasLocationId && movement.location_id) {
                await client.query(
                  `SELECT 1 FROM location_stock WHERE location_id = $1 AND item_id = $2 FOR UPDATE`,
                  [movement.location_id, item.item_id]
                );
                await client.query(
                  `UPDATE location_stock
                   SET current_stock_qty = GREATEST(0, current_stock_qty - $1),
                       last_updated = CURRENT_TIMESTAMP
                   WHERE location_id = $2 AND item_id = $3`,
                  [movementQty, movement.location_id, item.item_id]
                );
              } else if (!warehouseModeEnabled) {
                await adjustBranchVariantStock(
                  client,
                  purchase.business_id,
                  stockBranchId,
                  movement.variant_id,
                  -movementQty
                );
                await refreshVariantGlobalStockFromBranches(
                  client,
                  purchase.business_id,
                  movement.variant_id
                );
              }
            } else if (hasLocationId && movement.location_id && warehouseModeEnabled) {
              await client.query(
                `SELECT 1 FROM location_stock WHERE location_id = $1 AND item_id = $2 FOR UPDATE`,
                [movement.location_id, item.item_id]
              );
              await client.query(
                `UPDATE location_stock
                 SET current_stock_qty = GREATEST(0, current_stock_qty - $1),
                     last_updated = CURRENT_TIMESTAMP
                 WHERE location_id = $2 AND item_id = $3`,
                [movementQty, movement.location_id, item.item_id]
              );
            } else if (!warehouseModeEnabled) {
              await adjustBranchItemStock(
                client,
                purchase.business_id,
                stockBranchId,
                item.item_id,
                -movementQty
              );
              await refreshItemGlobalStockFromBranches(client, purchase.business_id, item.item_id);
            }

            // If batch tracking column exists and has a value, handle batch reversal
            if (hasBatchId && movement.batch_id) {
              try {
                await client.query(
                  `UPDATE item_batches
                   SET quantity = GREATEST(0, quantity - $1),
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = $2`,
                  [movementQty, movement.batch_id]
                );
              } catch (error: any) {
                // If item_batches table doesn't exist, just log and continue
                console.warn('Could not update item_batches:', error.message);
              }
            }

            // If serial tracking column exists and has a value, handle serial reversal
            if (hasSerialId && movement.serial_id) {
              try {
                await client.query(
                  `UPDATE item_serials
                   SET status = 'available',
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = $1`,
                  [movement.serial_id]
                );
              } catch (error: any) {
                // If item_serials table doesn't exist, just log and continue
                console.warn('Could not update item_serials:', error.message);
              }
            }

            // Delete stock movement
            await client.query(
              `DELETE FROM stock_movements WHERE id = $1`,
              [movement.id]
            );
          }

          // If no stock movements were found, still reverse the stock directly
          // This handles cases where stock was updated but movements weren't recorded
          if (stockMovements.rows.length === 0) {
            const piRes = await client.query(
              `SELECT variant_id, location_id FROM purchase_items WHERE purchase_id = $1 AND item_id = $2 LIMIT 1`,
              [purchaseId, item.item_id]
            );
            const pi = piRes.rows[0];
            if (pi?.variant_id) {
              if (warehouseModeEnabled && pi?.location_id) {
                await client.query(
                  `SELECT 1 FROM location_stock WHERE location_id = $1 AND item_id = $2 FOR UPDATE`,
                  [pi.location_id, item.item_id]
                );
                await client.query(
                  `UPDATE location_stock
                   SET current_stock_qty = GREATEST(0, current_stock_qty - $1),
                       last_updated = CURRENT_TIMESTAMP
                   WHERE location_id = $2 AND item_id = $3`,
                  [purchaseQuantity, pi.location_id, item.item_id]
                );
              } else if (!warehouseModeEnabled) {
                await adjustBranchVariantStock(
                  client,
                  purchase.business_id,
                  stockBranchId,
                  pi.variant_id,
                  -purchaseQuantity
                );
                await refreshVariantGlobalStockFromBranches(
                  client,
                  purchase.business_id,
                  pi.variant_id
                );
              }
            } else if (warehouseModeEnabled && pi?.location_id) {
              await client.query(
                `SELECT 1 FROM location_stock WHERE location_id = $1 AND item_id = $2 FOR UPDATE`,
                [pi.location_id, item.item_id]
              );
              await client.query(
                `UPDATE location_stock
                 SET current_stock_qty = GREATEST(0, current_stock_qty - $1),
                     last_updated = CURRENT_TIMESTAMP
                 WHERE location_id = $2 AND item_id = $3`,
                [purchaseQuantity, pi.location_id, item.item_id]
              );
            } else if (!warehouseModeEnabled) {
              await adjustBranchItemStock(
                client,
                purchase.business_id,
                stockBranchId,
                item.item_id,
                -purchaseQuantity
              );
              await refreshItemGlobalStockFromBranches(client, purchase.business_id, item.item_id);
            }
          }
        }
      }

      // Remove GL impact: purchase + payment voucher lines (otherwise balance sheet / TB stay wrong),
      // and reverse supplier subledger (current_balance) for the net outstanding on this bill.
      if (purchase.status === 'final') {
        const businessId = purchase.business_id as string;
        const payIdRes = await client.query<{ id: string }>(
          `SELECT id FROM payments
           WHERE business_id = $1 AND reference_type = 'purchase' AND reference_id = $2 AND deleted_at IS NULL`,
          [businessId, purchaseId]
        );
        const paymentIds = payIdRes.rows.map((r) => r.id);
        if (paymentIds.length > 0) {
          await client.query(
            `DELETE FROM ledger_entry_lines
             WHERE business_id = $1
               AND voucher_type = 'payment'
               AND voucher_id = ANY($2::uuid[])`,
            [businessId, paymentIds]
          );
        }
        await client.query(
          `DELETE FROM ledger_entry_lines
           WHERE business_id = $1
             AND voucher_type = 'purchase'
             AND voucher_id = $2`,
          [businessId, purchaseId]
        );
        if (purchase.supplier_id) {
          const netOutstanding = Number(purchase.balance_amount ?? 0) || 0;
          if (netOutstanding !== 0) {
            await client.query(
              `UPDATE suppliers
               SET current_balance = current_balance - $1,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $2 AND business_id = $3`,
              [netOutstanding, purchase.supplier_id, businessId]
            );
          }
        }
      }

      // Remove related payments: soft-delete when entitled, else hard delete
      if (useSoftDeletePurchase) {
        await client.query(
          `UPDATE payments
           SET deleted_at = CURRENT_TIMESTAMP
           WHERE reference_type = 'purchase'
             AND reference_id = $1
             AND business_id = $2
             AND deleted_at IS NULL`,
          [purchaseId, purchase.business_id]
        );
      } else {
        await client.query(
          `DELETE FROM payments
           WHERE reference_type = 'purchase'
             AND reference_id = $1
             AND business_id = $2`,
          [purchaseId, purchase.business_id]
        );
      }

      // Delete quantity request links
      await client.query(
        `UPDATE quantity_requests
         SET purchase_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE purchase_id = $1`,
        [purchaseId]
      );

      const purchaseDel = useSoftDeletePurchase
        ? await client.query(
            `UPDATE purchases
             SET deleted_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
             RETURNING id`,
            [purchaseId, purchase.business_id]
          )
        : await client.query(
            `DELETE FROM purchases
             WHERE id = $1 AND business_id = $2
             RETURNING id`,
            [purchaseId, purchase.business_id]
          );

      if (purchaseDel.rowCount === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Purchase not found' },
          { status: 404 }
        );
      }

      await client.query('COMMIT');

      return NextResponse.json({ 
        success: true,
        message: 'Purchase deleted successfully' 
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error deleting purchase:', error);
    return NextResponse.json(
      { error: 'Failed to delete purchase', details: error.message },
      { status: 500 }
    );
  }
}
