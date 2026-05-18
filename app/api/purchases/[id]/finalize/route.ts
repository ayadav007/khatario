import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows, getPool } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { applyPurchaseGoodsStockLine, PurchaseStockError } from '@/lib/purchase-goods-stock';
import { resolveCatalogItemIdForPurchase } from '@/lib/matching/resolve-catalog-item-for-purchase';
import { createCatalogItemFromAdHocPurchaseLine } from '@/lib/purchases/create-catalog-item-from-purchase-line';
import { getBusinessIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';

async function fetchPurchaseWithItems(id: string, businessId: string) {
  const purchase = await queryOne(
    `SELECT * FROM purchases WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [id, businessId]
  );
  if (!purchase) return null;
  const items = await queryRows(
    `SELECT * FROM purchase_items WHERE purchase_id = $1`,
    [id]
  );
  return { purchase, items };
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

  const current = await fetchPurchaseWithItems(id, businessScope);
  if (!current) {
    return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
  }
  const purchase = current.purchase;

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const bodyBranchId = typeof body.branch_id === 'string' && uuidRe.test(body.branch_id) ? body.branch_id : null;
  const stockBranchId = (purchase.branch_id as string | null) || bodyBranchId;
  if (!stockBranchId) {
    return NextResponse.json(
      {
        error: 'branch_id is required on the purchase or in the request body to finalize stock.',
        code: 'BRANCH_REQUIRED',
      },
      { status: 400 }
    );
  }

  if (purchase.status === 'cancelled') {
    return NextResponse.json({ error: 'Cannot finalize cancelled purchase' }, { status: 400 });
  }
  if (purchase.status === 'final') {
    return NextResponse.json({ purchase });
  }

  const userId = body.user_id || body.updated_by;
  
  if (!userId) {
    return NextResponse.json(
      { error: 'user_id is required for authorization' },
      { status: 400 }
    );
  }

  // AUTHORIZATION: Check update permission (finalize is an update operation)
  try {
    await authorize(userId, 'purchases', 'update', { 
      branchId: stockBranchId,
      businessId: purchase.business_id,
      resourceId: id
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    throw error;
  }

  // CRITICAL: Enforce subscription feature access
  try {
    await assertFeatureAccess(purchase.business_id, 'purchase_management');
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) {
      return error.toNextResponse();
    }
    throw error;
  }

  // Add stock with batch/serial tracking support
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!purchase.branch_id) {
      await client.query(
        `UPDATE purchases SET branch_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND business_id = $3`,
        [stockBranchId, id, purchase.business_id]
      );
    }

    // PHASE 5.3: Credit limit enforcement for suppliers
    if (purchase.supplier_id) {
      const supplierData = await client.query(
        `SELECT credit_limit, current_balance FROM suppliers WHERE id = $1 AND business_id = $2`,
        [purchase.supplier_id, purchase.business_id]
      );

      if (supplierData.rows.length > 0) {
        const creditLimit = parseFloat(supplierData.rows[0].credit_limit ?? '0');
        const currentBalance = parseFloat(supplierData.rows[0].current_balance ?? '0');
        
        // Calculate new purchase amount (balance after any payments)
        const purchaseBalance = purchase.balance_amount ?? (parseFloat(purchase.grand_total ?? '0') - parseFloat(purchase.paid_amount ?? '0'));
        const newTotalBalance = currentBalance + purchaseBalance;

        // Only enforce if credit_limit > 0 (0 means unlimited credit)
        if (creditLimit > 0 && newTotalBalance > creditLimit) {
          // Check for approved credit approval
          const approvalCheck = await client.query(
            `SELECT id, status FROM credit_approvals
             WHERE business_id = $1 AND reference_type = 'purchase' AND reference_id = $2 AND status = 'approved'`,
            [purchase.business_id, id]
          );

          if (approvalCheck.rows.length === 0) {
            // No approved override - block finalization
            const availableCredit = Math.max(0, creditLimit - currentBalance);
            await client.query('ROLLBACK');
            return NextResponse.json(
              {
                error: `Credit limit exceeded. Approval required. Available credit: ₹${availableCredit.toFixed(2)}`,
                code: 'CREDIT_LIMIT_EXCEEDED',
                credit_limit: creditLimit,
                current_balance: currentBalance,
                new_purchase_amount: purchaseBalance,
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

    // PBAC: Check warehouse access for each item (if warehouse mode enabled)
    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(purchase.business_id);
    
    if (warehouseModeEnabled && userId) {
      const { checkUserWarehouseAccess } = await import('@/lib/warehouse-access');
      
      for (const row of current.items) {
        if (!row.location_id) continue;
        
        const warehouseAccess = await checkUserWarehouseAccess(userId, row.location_id);
        
        if (!warehouseAccess?.can_create_transactions) {
          await client.query('ROLLBACK');
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

    if (warehouseModeEnabled) {
      const { isWarehouseAccessibleByBranch } = await import('@/lib/warehouse-access');
      for (const row of current.items) {
        if (!row.location_id) continue;
        const accessible = await isWarehouseAccessibleByBranch(row.location_id, stockBranchId);
        if (!accessible) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            {
              error: `Warehouse ${row.location_id} is not accessible by branch ${stockBranchId}. Cannot finalize purchase.`,
              item_id: row.item_id,
              item_name: row.item_name,
              warehouse_id: row.location_id,
              code: 'WAREHOUSE_BRANCH_MISMATCH',
            },
            { status: 400 }
          );
        }
      }
    }

    for (const row of current.items) {
      let resolvedItemId =
        row.item_id && String(row.item_id).trim() !== '' ? String(row.item_id).trim() : null;
      if (!resolvedItemId && row.item_name) {
        resolvedItemId = await resolveCatalogItemIdForPurchase(client, purchase.business_id, {
          name: String(row.item_name),
          hsn_sac: row.hsn_sac ?? null,
        });
        if (resolvedItemId && row.id) {
          await client.query(
            `UPDATE purchase_items SET item_id = $1 WHERE id = $2 AND purchase_id = $3`,
            [resolvedItemId, row.id, id],
          );
        }
      }

      const lineIntent = (row.line_item_type as string) || 'goods';
      const qty = Number(row.quantity) || 0;
      const taxable = Number(row.taxable_value) || 0;
      const unitCostForLine = qty > 0 ? taxable / qty : Number(row.unit_price) || 0;

      if (!resolvedItemId && String(row.item_name || '').trim().length > 0 && lineIntent === 'goods') {
        try {
          resolvedItemId = await createCatalogItemFromAdHocPurchaseLine(client, {
            businessId: purchase.business_id,
            createdBy: userId,
            rawLineName: String(row.item_name),
            unit: (row.unit as string) || 'PCS',
            purchasePrice: unitCostForLine,
            taxRate: Number(row.tax_rate) || 0,
            hsnSac: row.hsn_sac ?? null,
            defaultSupplierId: (purchase.supplier_id as string) || null,
          });
          if (resolvedItemId && row.id) {
            await client.query(`UPDATE purchase_items SET item_id = $1 WHERE id = $2 AND purchase_id = $3`, [
              resolvedItemId,
              row.id,
              id,
            ]);
          }
        } catch (e) {
          if (e instanceof PurchaseStockError) {
            await client.query('ROLLBACK');
            return NextResponse.json(
              {
                error: e.message,
                code: e.code,
                ...(e.details && typeof e.details === 'object' ? e.details : {}),
              },
              { status: e.statusCode },
            );
          }
          throw e;
        }
      }

      if (!resolvedItemId) continue;

      const itemTypeRes = await client.query(
        'SELECT item_type, track_batch, track_serial FROM items WHERE id = $1 AND business_id = $2',
        [resolvedItemId, purchase.business_id]
      );
      const itemData = itemTypeRes.rows[0];
      const itemType = itemData?.item_type || 'goods';

      if (itemType !== 'goods') continue;

      try {
        await applyPurchaseGoodsStockLine(
          client,
          {
            businessId: purchase.business_id,
            branchId: stockBranchId,
            purchaseId: purchase.id,
            supplierId: purchase.supplier_id,
            billRef: '',
            warehouseModeEnabled,
            trackBatch: itemData?.track_batch || false,
            trackSerial: itemData?.track_serial || false,
          },
          {
            item_id: resolvedItemId,
            variant_id: row.variant_id || null,
            item_name: row.item_name,
            quantity: Number(row.quantity) || 0,
            unit_price: Number(row.unit_price) || 0,
            location_id: row.location_id || null,
            batch_number: row.batch_number ?? null,
            serial_numbers: row.serial_numbers,
            manufacturing_date: row.manufacturing_date ?? null,
            expiry_date: row.expiry_date ?? null,
          }
        );
      } catch (e) {
        if (e instanceof PurchaseStockError) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            {
              error: e.message,
              code: e.code,
              ...(e.details && typeof e.details === 'object' ? e.details : {}),
            },
            { status: e.statusCode }
          );
        }
        throw e;
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
    `UPDATE purchases
     SET status = 'final', is_editable = false, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [id, businessScope]
  );

  return NextResponse.json({ purchase: updated });
}

