/**
 * Inventory Adjustment Service
 * Handles quantity and value adjustments with accounting integration
 */

import { query, queryOne, queryRows, getPool } from '@/lib/db';
import {
  adjustBranchVariantStock,
  getBranchVariantQuantity,
  getBranchVariantQuantityDb,
  refreshVariantGlobalStockFromBranches,
} from '@/lib/branch-variant-stock';
import { createLedgerEntryLine } from './ledger-utils';
import { getDefaultAccounts } from './ledger-utils';

export type AdjustmentType = 'QUANTITY' | 'VALUE';
export type AdjustmentDirection = 'INCREASE' | 'DECREASE';
export type ReasonCode = 
  | 'STOCK_TAKE'
  | 'DAMAGE'
  | 'THEFT'
  | 'EXPIRED'
  | 'FREE_SAMPLE'
  | 'COST_CORRECTION'
  | 'LANDED_COST'
  | 'REVALUATION'
  | 'WRITE_DOWN';

export interface QuantityAdjustmentParams {
  businessId: string;
  itemId: string;
  variantId?: string | null;
  locationId?: string | null;
  /** Required when warehouse mode is off (branch-level stock). */
  branchId?: string | null;
  direction: AdjustmentDirection;
  quantity: number;
  reasonCode: ReasonCode;
  reasonNotes?: string;
  notes?: string;
  adjustmentDate: string; // ISO date string
  createdBy?: string;
}

export interface ValueAdjustmentParams {
  businessId: string;
  itemId: string;
  variantId?: string | null;
  locationId?: string | null;
  /** When warehouse mode is off, required for quantity context on branch stock / variant branch stock. */
  branchId?: string | null;
  valueChange: number; // Signed: positive for increase, negative for decrease
  reasonCode: ReasonCode;
  reasonNotes?: string;
  notes?: string;
  adjustmentDate: string; // ISO date string
  createdBy?: string;
  gstImpact?: number; // GST impact for value adjustments
}

export interface AdjustmentResult {
  adjustmentId: string;
  adjustmentNumber: string;
  quantityBefore: number;
  quantityAfter: number;
  unitCostBefore: number;
  unitCostAfter: number;
  totalValueBefore: number;
  totalValueAfter: number;
  journalEntryId?: string;
}

/**
 * Create a quantity adjustment
 */
export async function createQuantityAdjustment(
  params: QuantityAdjustmentParams
): Promise<AdjustmentResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if warehouse mode is enabled
    const { isWarehouseModeEnabled } = await import('./warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(params.businessId);
    
    // CRITICAL: location_id is MANDATORY when warehouse mode is enabled
    if (warehouseModeEnabled && !params.locationId) {
      await client.query('ROLLBACK');
      client.release();
      throw new Error('location_id (warehouse) is required. Warehouse mode is enabled - stock operations require warehouse context.');
    }

    let branchIdForStock: string | null = params.branchId || null;
    if (!warehouseModeEnabled) {
      if (!branchIdForStock) {
        const { getDefaultBranchId } = await import('./branch-helpers');
        branchIdForStock = (await getDefaultBranchId(params.businessId)) || null;
      }
      if (!branchIdForStock) {
        await client.query('ROLLBACK');
        client.release();
        throw new Error('branch_id is required for quantity adjustments when warehouse mode is disabled.');
      }
    }

    // Generate adjustment number
    const adjustmentNumber = await generateAdjustmentNumber(params.businessId, client);

    // Determine quantity change (positive for increase, negative for decrease)
    const quantityChange = params.direction === 'INCREASE' 
      ? Math.abs(params.quantity) 
      : -Math.abs(params.quantity);

    // Lock the item/variant row for update
    const itemLockQuery = params.variantId
      ? `SELECT * FROM item_variants WHERE id = $1 FOR UPDATE`
      : `SELECT * FROM items WHERE id = $1 FOR UPDATE`;
    
    const itemIdToLock = params.variantId || params.itemId;
    const itemResult = await client.query(itemLockQuery, [itemIdToLock]);
    
    if (itemResult.rows.length === 0) {
      throw new Error(params.variantId ? 'Variant not found' : 'Item not found');
    }

    const item = itemResult.rows[0];
    const currentPurchasePrice = parseFloat(item.purchase_price || '0');
    
    // Get current stock - conditional based on warehouse mode and variant
    let currentStock: number;
    let newQuantity: number;
    
    if (params.variantId) {
      if (warehouseModeEnabled && params.locationId) {
        const locationStockResult = await client.query(
          `SELECT current_stock_qty FROM location_stock WHERE location_id = $1 AND item_id = $2`,
          [params.locationId, params.itemId]
        );
        currentStock = parseFloat(locationStockResult.rows[0]?.current_stock_qty || '0');
      } else if (!warehouseModeEnabled && branchIdForStock) {
        currentStock = await getBranchVariantQuantity(
          client,
          params.businessId,
          branchIdForStock,
          params.variantId
        );
      } else {
        await client.query('ROLLBACK');
        client.release();
        throw new Error(
          'Variant quantity adjustments require location_id when warehouse mode is enabled, or branch_id when warehouse mode is disabled.'
        );
      }
      newQuantity = currentStock + quantityChange;
    } else if (warehouseModeEnabled && params.locationId) {
      // Warehouse mode: get stock from location_stock
      const locationStockResult = await client.query(
        `SELECT current_stock_qty FROM location_stock WHERE location_id = $1 AND item_id = $2`,
        [params.locationId, params.itemId]
      );
      currentStock = parseFloat(locationStockResult.rows[0]?.current_stock_qty || '0');
      newQuantity = currentStock + quantityChange;
    } else if (!warehouseModeEnabled && branchIdForStock) {
      const bis = await client.query(
        `SELECT quantity FROM branch_item_stock WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`,
        [params.businessId, branchIdForStock, params.itemId]
      );
      currentStock = parseFloat(bis.rows[0]?.quantity || '0');
      newQuantity = currentStock + quantityChange;
    } else {
      await client.query('ROLLBACK');
      client.release();
      throw new Error('Could not resolve stock context for quantity adjustment.');
    }
    
    if (newQuantity < 0) {
      throw new Error('Quantity cannot go below zero');
    }

    // Calculate value change (quantity_change * unit_cost)
    const valueChange = quantityChange * currentPurchasePrice;
    const currentTotalValue = currentStock * currentPurchasePrice;
    const newTotalValue = newQuantity * currentPurchasePrice;

    // Database column is DECIMAL(10,2), so round to 2 decimal places
    const newQuantityDecimal = parseFloat(newQuantity.toFixed(2));
    
    // Update stock - conditional based on warehouse mode
    if (params.variantId) {
      if (warehouseModeEnabled && params.locationId) {
        await client.query(
          `SELECT * FROM location_stock WHERE location_id = $1 AND item_id = $2 FOR UPDATE`,
          [params.locationId, params.itemId]
        );
        await client.query(
          `INSERT INTO location_stock (location_id, item_id, current_stock_qty, last_updated)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
           ON CONFLICT (location_id, item_id)
           DO UPDATE SET
             current_stock_qty = $3,
             last_updated = CURRENT_TIMESTAMP`,
          [params.locationId, params.itemId, newQuantityDecimal]
        );
      } else if (!warehouseModeEnabled && branchIdForStock) {
        await adjustBranchVariantStock(
          client,
          params.businessId,
          branchIdForStock,
          params.variantId,
          quantityChange
        );
        await refreshVariantGlobalStockFromBranches(client, params.businessId, params.variantId);
      }
    } else {
      // Regular items: conditional based on warehouse mode
      if (warehouseModeEnabled && params.locationId) {
        // Warehouse mode: update ONLY location_stock
        // Lock location stock for update (already got currentStock above)
        await client.query(`
          SELECT * FROM location_stock 
          WHERE location_id = $1 AND item_id = $2
          FOR UPDATE
        `, [params.locationId, params.itemId]);

        // Update location_stock (currentStock already calculated above)
        await client.query(
          `INSERT INTO location_stock (location_id, item_id, current_stock_qty, last_updated)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
           ON CONFLICT (location_id, item_id) 
           DO UPDATE SET 
             current_stock_qty = $3,
             last_updated = CURRENT_TIMESTAMP`,
          [params.locationId, params.itemId, newQuantityDecimal]
        );

        console.log('[InventoryAdjustment] Updated location stock:', {
          locationId: params.locationId,
          itemId: params.itemId,
          before: currentStock,
          after: newQuantityDecimal,
          change: quantityChange
        });
      } else if (!warehouseModeEnabled && branchIdForStock) {
        const { adjustBranchItemStock, refreshItemGlobalStockFromBranches } = await import('./branch-stock');
        await adjustBranchItemStock(
          client,
          params.businessId,
          branchIdForStock,
          params.itemId,
          quantityChange
        );
        await refreshItemGlobalStockFromBranches(client, params.businessId, params.itemId);
      }
    }

    let branchIdFromWarehouse: string | undefined;
    if (params.locationId) {
      const warehouseRes = await client.query(
        'SELECT branch_id FROM warehouses WHERE id = $1 AND business_id = $2',
        [params.locationId, params.businessId]
      );
      if (warehouseRes.rows.length > 0 && warehouseRes.rows[0].branch_id) {
        branchIdFromWarehouse = warehouseRes.rows[0].branch_id;
      }
    }
    const adjustmentBranchId = branchIdFromWarehouse || branchIdForStock || null;

    // Create adjustment record FIRST (so we have the ID for stock_movements)
    const adjustmentResult = await client.query(
      `INSERT INTO inventory_adjustments (
        business_id, adjustment_number, adjustment_date, adjustment_type, direction,
        item_id, variant_id, location_id, branch_id,
        quantity_change, quantity_before, quantity_after,
        unit_cost_before, unit_cost_after,
        total_value_before, total_value_after,
        reason_code, reason_notes, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING id`,
      [
        params.businessId,
        adjustmentNumber,
        params.adjustmentDate,
        'QUANTITY',
        params.direction,
        params.itemId,
        params.variantId || null,
        params.locationId || null,
        adjustmentBranchId,
        quantityChange,
        currentStock,
        newQuantity,
        currentPurchasePrice,
        currentPurchasePrice, // Unit cost doesn't change for quantity adjustments
        currentTotalValue,
        newTotalValue,
        params.reasonCode,
        params.reasonNotes || null,
        params.notes || null,
        params.createdBy || null
      ]
    );

    const adjustmentId = adjustmentResult.rows[0].id;

    // Create stock movement record with adjustment reference
    // Always include location_id when provided
    await client.query(
      `INSERT INTO stock_movements (
        business_id, item_id, variant_id, location_id, type, quantity, 
        reference_type, reference_id, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        params.businessId,
        params.itemId,
        params.variantId || null,
        params.locationId || null, // Always include location_id when provided
        'adjustment',
        quantityChange,
        'adjustment',
        adjustmentId, // Use adjustment ID directly
        `Inventory adjustment: ${params.direction} ${Math.abs(params.quantity)} units. Reason: ${params.reasonCode}`,
        params.createdBy || null
      ]
    );

    const branchId = adjustmentBranchId || undefined;

    // Create journal entry if accounting is enabled
    let journalEntryId: string | undefined;
    try {
      const accounts = await getDefaultAccounts(params.businessId);
      
      if (accounts.inventory) {
        // For quantity adjustments:
        // - If INCREASE: Debit Inventory, Credit Adjustment Account (or Expense Reversal)
        // - If DECREASE: Debit Adjustment Account (or Expense), Credit Inventory
        
        const adjustmentAccount = await getAccountForReasonCode(
          params.businessId,
          params.reasonCode,
          params.direction === 'DECREASE'
        );

        if (adjustmentAccount) {
          if (params.direction === 'INCREASE') {
            // Debit Inventory, Credit Adjustment Account
            const entryId = await createLedgerEntryLine({
              businessId: params.businessId,
              voucherId: adjustmentId,
              voucherType: 'journal',
              accountId: accounts.inventory.id,
              entryDate: params.adjustmentDate,
              debit: Math.abs(valueChange),
              credit: 0,
              narration: `Inventory adjustment: ${params.direction} ${Math.abs(params.quantity)} units - ${params.reasonCode}`,
              referenceNumber: adjustmentNumber,
              branchId: branchId,
            });

            await createLedgerEntryLine({
              businessId: params.businessId,
              voucherId: adjustmentId,
              voucherType: 'journal',
              accountId: adjustmentAccount.id,
              entryDate: params.adjustmentDate,
              debit: 0,
              credit: Math.abs(valueChange),
              narration: `Inventory adjustment: ${params.direction} ${Math.abs(params.quantity)} units - ${params.reasonCode}`,
              referenceNumber: adjustmentNumber,
              branchId: branchId,
            });

            journalEntryId = entryId;
          } else {
            // Debit Adjustment Account, Credit Inventory
            await createLedgerEntryLine({
              businessId: params.businessId,
              voucherId: adjustmentId,
              voucherType: 'journal',
              accountId: adjustmentAccount.id,
              entryDate: params.adjustmentDate,
              debit: Math.abs(valueChange),
              credit: 0,
              narration: `Inventory adjustment: ${params.direction} ${Math.abs(params.quantity)} units - ${params.reasonCode}`,
              referenceNumber: adjustmentNumber,
              branchId: branchId,
            });

            const entryId = await createLedgerEntryLine({
              businessId: params.businessId,
              voucherId: adjustmentId,
              voucherType: 'journal',
              accountId: accounts.inventory.id,
              entryDate: params.adjustmentDate,
              debit: 0,
              credit: Math.abs(valueChange),
              narration: `Inventory adjustment: ${params.direction} ${Math.abs(params.quantity)} units - ${params.reasonCode}`,
              referenceNumber: adjustmentNumber,
              branchId: branchId,
            });

            journalEntryId = entryId;
          }

          // Update adjustment with journal entry reference (only if journal entry was created)
          if (journalEntryId) {
            await client.query(
              `UPDATE inventory_adjustments SET journal_entry_id = $1 WHERE id = $2`,
              [journalEntryId, adjustmentId]
            );
          }
        }
      }
    } catch (accountingError) {
      console.error('Error creating journal entry for adjustment:', accountingError);
      // Don't fail the adjustment if accounting fails
    }

    // Commit the transaction
    await client.query('COMMIT');
    console.log('[InventoryAdjustment] Transaction committed successfully for adjustment:', adjustmentId);

    // Verify the update persisted (using a new query to ensure we see committed data)
    if (params.variantId) {
      if (warehouseModeEnabled && params.locationId) {
        const verifyResult = await client.query(
          `SELECT current_stock_qty FROM location_stock WHERE location_id = $1 AND item_id = $2`,
          [params.locationId, params.itemId]
        );
        const verifiedStock = parseFloat(verifyResult.rows[0]?.current_stock_qty || '0');
        if (Math.abs(verifiedStock - newQuantityDecimal) >= 0.01) {
          console.error('[InventoryAdjustment] CRITICAL: Variant location stock mismatch', {
            expected: newQuantityDecimal,
            actual: verifiedStock,
            adjustmentId,
          });
        }
      } else if (!warehouseModeEnabled && branchIdForStock) {
        const verifiedStock = await getBranchVariantQuantityDb(
          params.businessId,
          branchIdForStock,
          params.variantId
        );
        if (Math.abs(verifiedStock - newQuantityDecimal) >= 0.01) {
          console.error('[InventoryAdjustment] CRITICAL: Branch variant stock mismatch', {
            expected: newQuantityDecimal,
            actual: verifiedStock,
            adjustmentId,
          });
        }
      }
    } else if (warehouseModeEnabled && params.locationId) {
      // Warehouse mode: verify location_stock
      const verifyResult = await client.query(
        `SELECT current_stock_qty FROM location_stock WHERE location_id = $1 AND item_id = $2`,
        [params.locationId, params.itemId]
      );
      const verifiedStock = parseFloat(verifyResult.rows[0]?.current_stock_qty || '0');
      const expectedLocationStock = newQuantity; // Already calculated above
      
      console.log('[InventoryAdjustment] Post-commit verification (warehouse):', {
        locationId: params.locationId,
        itemId: params.itemId,
        expectedStock: expectedLocationStock,
        verifiedStock: verifiedStock,
        match: Math.abs(verifiedStock - expectedLocationStock) < 0.01
      });

      if (Math.abs(verifiedStock - expectedLocationStock) >= 0.01) {
        console.error('[InventoryAdjustment] CRITICAL: Location stock update did not persist!', {
          expected: expectedLocationStock,
          actual: verifiedStock,
          adjustmentId
        });
      }
    } else if (!warehouseModeEnabled && branchIdForStock) {
      const { getBranchItemQuantityDb } = await import('./branch-stock');
      const verifiedStock = await getBranchItemQuantityDb(
        params.businessId,
        branchIdForStock,
        params.itemId
      );
      if (Math.abs(verifiedStock - newQuantityDecimal) >= 0.01) {
        console.error('[InventoryAdjustment] CRITICAL: Branch item stock mismatch', {
          expected: newQuantityDecimal,
          actual: verifiedStock,
          adjustmentId,
        });
      }
    }

    return {
      adjustmentId,
      adjustmentNumber,
      quantityBefore: currentStock,
      quantityAfter: newQuantity,
      unitCostBefore: currentPurchasePrice,
      unitCostAfter: currentPurchasePrice,
      totalValueBefore: currentTotalValue,
      totalValueAfter: newTotalValue,
      journalEntryId
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[InventoryAdjustment] Transaction rolled back due to error:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Create a value adjustment
 */
export async function createValueAdjustment(
  params: ValueAdjustmentParams
): Promise<AdjustmentResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if warehouse mode is enabled
    const { isWarehouseModeEnabled } = await import('./warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(params.businessId);
    
    // CRITICAL: location_id is MANDATORY when warehouse mode is enabled
    if (warehouseModeEnabled && !params.locationId) {
      await client.query('ROLLBACK');
      client.release();
      throw new Error('location_id (warehouse) is required. Warehouse mode is enabled - stock operations require warehouse context.');
    }

    let branchIdForValue: string | null = params.branchId ?? null;
    if (!warehouseModeEnabled) {
      if (!branchIdForValue) {
        const { getDefaultBranchId } = await import('./branch-helpers');
        branchIdForValue = (await getDefaultBranchId(params.businessId)) || null;
      }
      if (!branchIdForValue) {
        await client.query('ROLLBACK');
        client.release();
        throw new Error('branch_id is required for value adjustments when warehouse mode is disabled.');
      }
    }

    // Generate adjustment number
    const adjustmentNumber = await generateAdjustmentNumber(params.businessId, client);

    // Lock the item/variant row for update
    const itemLockQuery = params.variantId
      ? `SELECT * FROM item_variants WHERE id = $1 FOR UPDATE`
      : `SELECT * FROM items WHERE id = $1 FOR UPDATE`;
    
    const itemIdToLock = params.variantId || params.itemId;
    const itemResult = await client.query(itemLockQuery, [itemIdToLock]);
    
    if (itemResult.rows.length === 0) {
      throw new Error(params.variantId ? 'Variant not found' : 'Item not found');
    }

    const item = itemResult.rows[0];
    let currentStock: number;
    if (params.variantId) {
      if (warehouseModeEnabled && params.locationId) {
        const ls = await client.query(
          `SELECT current_stock_qty FROM location_stock WHERE location_id = $1 AND item_id = $2`,
          [params.locationId, params.itemId]
        );
        currentStock = parseFloat(ls.rows[0]?.current_stock_qty || '0');
      } else if (!warehouseModeEnabled && branchIdForValue) {
        currentStock = await getBranchVariantQuantity(
          client,
          params.businessId,
          branchIdForValue,
          params.variantId
        );
      } else {
        currentStock = parseFloat(item.current_stock || '0');
      }
    } else if (warehouseModeEnabled && params.locationId) {
      const ls = await client.query(
        `SELECT current_stock_qty FROM location_stock WHERE location_id = $1 AND item_id = $2`,
        [params.locationId, params.itemId]
      );
      currentStock = parseFloat(ls.rows[0]?.current_stock_qty || '0');
    } else if (!warehouseModeEnabled && branchIdForValue) {
      const bis = await client.query(
        `SELECT quantity FROM branch_item_stock WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`,
        [params.businessId, branchIdForValue, params.itemId]
      );
      currentStock = parseFloat(bis.rows[0]?.quantity || '0');
    } else {
      currentStock = parseFloat(item.current_stock || '0');
    }

    const currentPurchasePrice = parseFloat(item.purchase_price || '0');
    
    // Prevent value adjustment when quantity is zero
    if (currentStock === 0) {
      throw new Error('Cannot adjust value when quantity is zero');
    }

    // Calculate new total value
    const currentTotalValue = currentStock * currentPurchasePrice;
    const newTotalValue = currentTotalValue + params.valueChange;
    
    if (newTotalValue < 0) {
      throw new Error('Total value cannot go below zero');
    }

    // Calculate new unit cost
    const newUnitCost = newTotalValue / currentStock;

    // Update purchase_price in items or item_variants table
    if (params.variantId) {
      await client.query(
        `UPDATE item_variants 
         SET purchase_price = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [newUnitCost, params.variantId]
      );
    } else {
      await client.query(
        `UPDATE items 
         SET purchase_price = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [newUnitCost, params.itemId]
      );
    }

    let branchIdFromWarehouse: string | undefined;
    if (params.locationId) {
      const warehouseRes = await client.query(
        'SELECT branch_id FROM warehouses WHERE id = $1 AND business_id = $2',
        [params.locationId, params.businessId]
      );
      if (warehouseRes.rows.length > 0 && warehouseRes.rows[0].branch_id) {
        branchIdFromWarehouse = warehouseRes.rows[0].branch_id;
      }
    }
    const adjustmentBranchIdForRow = branchIdFromWarehouse || branchIdForValue || null;

    // Create adjustment record
    const adjustmentResult = await client.query(
      `INSERT INTO inventory_adjustments (
        business_id, adjustment_number, adjustment_date, adjustment_type,
        item_id, variant_id, location_id, branch_id,
        value_change, quantity_before, quantity_after,
        unit_cost_before, unit_cost_after,
        total_value_before, total_value_after,
        reason_code, reason_notes, notes, gst_impact, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING id`,
      [
        params.businessId,
        adjustmentNumber,
        params.adjustmentDate,
        'VALUE',
        params.itemId,
        params.variantId || null,
        params.locationId || null,
        adjustmentBranchIdForRow,
        params.valueChange,
        currentStock,
        currentStock, // Quantity remains unchanged
        currentPurchasePrice,
        newUnitCost,
        currentTotalValue,
        newTotalValue,
        params.reasonCode,
        params.reasonNotes || null,
        params.notes || null,
        params.gstImpact || 0,
        params.createdBy || null
      ]
    );

    const adjustmentId = adjustmentResult.rows[0].id;

    const branchId: string | undefined = adjustmentBranchIdForRow || undefined;

    // Create journal entry if accounting is enabled
    let journalEntryId: string | undefined;
    try {
      const accounts = await getDefaultAccounts(params.businessId);
      
      if (accounts.inventory) {
        // For value adjustments:
        // - If value INCREASE: Debit Inventory, Credit Adjustment Account
        // - If value DECREASE: Debit Adjustment Account, Credit Inventory
        
        const adjustmentAccount = await getAccountForReasonCode(
          params.businessId,
          params.reasonCode,
          params.valueChange < 0
        );

        if (adjustmentAccount) {
          if (params.valueChange > 0) {
            // Debit Inventory, Credit Adjustment Account
            const entryId = await createLedgerEntryLine({
              businessId: params.businessId,
              voucherId: adjustmentId,
              voucherType: 'journal',
              accountId: accounts.inventory.id,
              entryDate: params.adjustmentDate,
              debit: Math.abs(params.valueChange),
              credit: 0,
              narration: `Inventory value adjustment: ${params.reasonCode} - ${params.reasonNotes || ''}`,
              referenceNumber: adjustmentNumber,
              branchId: branchId,
            });

            await createLedgerEntryLine({
              businessId: params.businessId,
              voucherId: adjustmentId,
              voucherType: 'journal',
              accountId: adjustmentAccount.id,
              entryDate: params.adjustmentDate,
              debit: 0,
              credit: Math.abs(params.valueChange),
              narration: `Inventory value adjustment: ${params.reasonCode} - ${params.reasonNotes || ''}`,
              referenceNumber: adjustmentNumber,
              branchId: branchId,
            });

            journalEntryId = entryId;
          } else {
            // Debit Adjustment Account, Credit Inventory
            await createLedgerEntryLine({
              businessId: params.businessId,
              voucherId: adjustmentId,
              voucherType: 'journal',
              accountId: adjustmentAccount.id,
              entryDate: params.adjustmentDate,
              debit: Math.abs(params.valueChange),
              credit: 0,
              narration: `Inventory value adjustment: ${params.reasonCode} - ${params.reasonNotes || ''}`,
              referenceNumber: adjustmentNumber,
              branchId: branchId,
            });

            const entryId = await createLedgerEntryLine({
              businessId: params.businessId,
              voucherId: adjustmentId,
              voucherType: 'journal',
              accountId: accounts.inventory.id,
              entryDate: params.adjustmentDate,
              debit: 0,
              credit: Math.abs(params.valueChange),
              narration: `Inventory value adjustment: ${params.reasonCode} - ${params.reasonNotes || ''}`,
              referenceNumber: adjustmentNumber,
              branchId: branchId,
            });

            journalEntryId = entryId;
          }

          // Update adjustment with journal entry reference
          await client.query(
            `UPDATE inventory_adjustments SET journal_entry_id = $1 WHERE id = $2`,
            [journalEntryId, adjustmentId]
          );
        }
      }
    } catch (accountingError) {
      console.error('Error creating journal entry for adjustment:', accountingError);
      // Don't fail the adjustment if accounting fails
    }

    await client.query('COMMIT');

    return {
      adjustmentId,
      adjustmentNumber,
      quantityBefore: currentStock,
      quantityAfter: currentStock,
      unitCostBefore: currentPurchasePrice,
      unitCostAfter: newUnitCost,
      totalValueBefore: currentTotalValue,
      totalValueAfter: newTotalValue,
      journalEntryId
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Generate unique adjustment number
 */
async function generateAdjustmentNumber(
  businessId: string,
  client: any
): Promise<string> {
  const result = await client.query(
    `SELECT generate_adjustment_number($1) as number`,
    [businessId]
  );
  return result.rows[0].number;
}

/**
 * Get appropriate account for reason code
 * Maps reason codes to appropriate expense/income accounts
 */
async function getAccountForReasonCode(
  businessId: string,
  reasonCode: ReasonCode,
  isExpense: boolean
): Promise<any> {
  const { getAccountByCode, getAccountByName } = await import('./ledger-utils');
  
  // Map reason codes to account codes
  const accountMappings: Record<ReasonCode, { expense: string; income: string }> = {
    STOCK_TAKE: { expense: '5102', income: '4102' }, // Stock Adjustment Expense / Stock Adjustment Income
    DAMAGE: { expense: '5103', income: '4103' }, // Damage/Loss Expense / Damage Recovery
    THEFT: { expense: '5104', income: '4104' }, // Theft Loss / Theft Recovery
    EXPIRED: { expense: '5105', income: '4105' }, // Expiry Loss / Expiry Recovery
    FREE_SAMPLE: { expense: '5106', income: '4106' }, // Sample Expense / Sample Income
    COST_CORRECTION: { expense: '5107', income: '4107' }, // Cost Correction Expense / Cost Correction Income
    LANDED_COST: { expense: '5108', income: '4108' }, // Landed Cost / Landed Cost Recovery
    REVALUATION: { expense: '5109', income: '4109' }, // Revaluation Loss / Revaluation Gain
    WRITE_DOWN: { expense: '5110', income: '4110' } // Write Down Expense / Write Down Recovery
  };

  const mapping = accountMappings[reasonCode];
  const accountCode = isExpense ? mapping.expense : mapping.income;
  
  // Try to get account by code first
  let account = await getAccountByCode(businessId, accountCode);
  
  // If not found, try to get a generic adjustment account
  if (!account) {
    account = await getAccountByName(businessId, isExpense ? 'Stock Adjustment Expense' : 'Stock Adjustment Income');
  }
  
  // If still not found, try to get any expense/income account
  if (!account) {
    const accounts = await getDefaultAccounts(businessId);
    account = (isExpense ? accounts.expenses : accounts.sales) || null;
  }
  
  return account;
}
