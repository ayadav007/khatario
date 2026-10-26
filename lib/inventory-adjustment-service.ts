/**
 * Inventory Adjustment Service
 * Handles quantity and value adjustments with accounting integration
 */

import { query, queryOne, queryRows, getPool } from '@/lib/db';
import {
  adjustBranchVariantStock,
  getBranchVariantQuantity,
  refreshVariantGlobalStockFromBranches,
} from '@/lib/branch-variant-stock';
import { currentUnitCosts } from '@/lib/inventory/cogs-posting';
import { fifoCostForDocument, getValuationMethod } from '@/lib/inventory/fifo-costing';
import { recostAfterStockChange } from '@/lib/inventory/fifo-recost';
import { postInventoryAdjustment } from '@/lib/inventory/adjustment-posting';
import type { PoolClient } from 'pg';
import type { OpeningBatch } from '@/lib/items/opening-batch';
import { findReplayLog, insertReplayLogPending, markReplayCompleted } from '@/lib/offline-sync/replay-log-repository';

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
  | 'WRITE_DOWN'
  | 'PROCESS_LOSS'
  | 'TRANSIT_LOSS'
  | 'OWN_CONSUMPTION'
  | 'CUSTODY_LOSS'
  | 'PRODUCTION_ISSUE'
  | 'PRODUCTION_RECEIPT'
  | 'BY_PRODUCT';

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
  /**
   * Batch and dates of the stock being added (Scan & Add Items). On an INCREASE the quantity goes
   * into that batch and the item is switched to batch tracking with FIFO, as for opening stock.
   */
  batch?: OpeningBatch | null;
  /** Retry key, recorded in this transaction so a retried request returns the first adjustment. */
  idempotency?: { scopedKey: string; hash: string; storedPayload: Record<string, unknown> } | null;
}

export const ADJUSTMENT_IDEMPOTENCY_ACTION = 'inventory_adjustments.create';

/** A retry key reused for a different adjustment, or one whose first request is still running. */
export class AdjustmentIdempotencyError extends Error {
  constructor(public readonly code: 'IDEMPOTENCY_KEY_REUSED' | 'IDEMPOTENCY_IN_PROGRESS', message: string) {
    super(message);
  }
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
  /** True when this is the stored answer to a retried request. */
  replayed?: boolean;
}

/** The adjustment a completed retry key points at, for this business only. */
async function replayedAdjustment(
  client: PoolClient,
  businessId: string,
  idem: NonNullable<QuantityAdjustmentParams['idempotency']>
): Promise<AdjustmentResult> {
  const row = await findReplayLog(businessId, idem.scopedKey, client);
  if (!row || row.request_hash !== idem.hash || row.action_type !== ADJUSTMENT_IDEMPOTENCY_ACTION) {
    throw new AdjustmentIdempotencyError('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different stock change.');
  }
  if (row.status !== 'completed' || !row.entity_id) {
    throw new AdjustmentIdempotencyError('IDEMPOTENCY_IN_PROGRESS', 'This stock change is still being saved. Try again in a moment.');
  }
  const a = (
    await client.query(
      `SELECT id, adjustment_number, quantity_before, quantity_after, unit_cost_before, unit_cost_after,
              total_value_before, total_value_after
         FROM inventory_adjustments WHERE id = $1 AND business_id = $2`,
      [row.entity_id, businessId]
    )
  ).rows[0];
  if (!a) throw new AdjustmentIdempotencyError('IDEMPOTENCY_KEY_REUSED', 'This idempotency key cannot be replayed.');
  return {
    adjustmentId: a.id,
    adjustmentNumber: a.adjustment_number,
    quantityBefore: Number(a.quantity_before),
    quantityAfter: Number(a.quantity_after),
    unitCostBefore: Number(a.unit_cost_before),
    unitCostAfter: Number(a.unit_cost_after),
    totalValueBefore: Number(a.total_value_before),
    totalValueAfter: Number(a.total_value_after),
    replayed: true,
  };
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

    let idemRowId: string | null = null;
    if (params.idempotency) {
      const inserted = await insertReplayLogPending(client, {
        businessId: params.businessId,
        idempotencyKey: params.idempotency.scopedKey,
        actionType: ADJUSTMENT_IDEMPOTENCY_ACTION,
        requestHash: params.idempotency.hash,
        requestPayload: params.idempotency.storedPayload,
        // Nullable column; a system adjustment has no user.
        userId: params.createdBy as string,
      });
      if (!inserted) {
        // The key is already recorded (an earlier or concurrent request committed it).
        await client.query('ROLLBACK');
        return await replayedAdjustment(client, params.businessId, params.idempotency);
      }
      idemRowId = inserted.id;
    }

    const result = await createQuantityAdjustmentOn(client, params);

    if (idemRowId) {
      await markReplayCompleted(client, idemRowId, { adjustment_id: result.adjustmentId }, { type: 'inventory_adjustment', id: result.adjustmentId });
    }

    await client.query('COMMIT');
    return result;
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[InventoryAdjustment] Transaction rolled back due to error:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Quantity adjustment on the caller's transaction (stock counts and challan write-offs post
 * several in one transaction). Errors propagate; the caller rolls back.
 */
export async function createQuantityAdjustmentOn(
  client: PoolClient,
  params: QuantityAdjustmentParams & {
    stockCountId?: string | null;
    /** Cost per unit of an INCREASE (production output), instead of the current unit cost. */
    unitCostOverride?: number | null;
    /** Ledger account on the other side of the inventory line (production uses work in progress). */
    counterCodes?: string[];
    /** Stock movement reference, when the adjustment belongs to another document (a production entry). */
    movementReference?: { type: string; id: string } | null;
  }
): Promise<AdjustmentResult> {
    // Check if warehouse mode is enabled
    const { isWarehouseModeEnabled } = await import('./warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(params.businessId);

    // CRITICAL: location_id is MANDATORY when warehouse mode is enabled
    if (warehouseModeEnabled && !params.locationId) {
      throw new Error('location_id (warehouse) is required. Warehouse mode is enabled - stock operations require warehouse context.');
    }

    let branchIdForStock: string | null = params.branchId || null;
    if (!warehouseModeEnabled) {
      if (!branchIdForStock) {
        const { getDefaultBranchId } = await import('./branch-helpers');
        branchIdForStock = (await getDefaultBranchId(params.businessId)) || null;
      }
      if (!branchIdForStock) {
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
      ? `SELECT v.* FROM item_variants v JOIN items i ON i.id = v.item_id
          WHERE v.id = $1 AND i.business_id = $2 FOR UPDATE OF v`
      : `SELECT * FROM items WHERE id = $1 AND business_id = $2 FOR UPDATE`;
    
    const itemIdToLock = params.variantId || params.itemId;
    const itemResult = await client.query(itemLockQuery, [itemIdToLock, params.businessId]);
    
    if (itemResult.rows.length === 0) {
      throw new Error(params.variantId ? 'Variant not found' : 'Item not found');
    }

    const item = itemResult.rows[0];
    let currentPurchasePrice = parseFloat(item.purchase_price || '0');
    const fifo = (await getValuationMethod(client, params.businessId)) === 'fifo';
    if (!params.variantId || fifo) {
      const unit = await currentUnitCosts(client, params.businessId, [params.itemId], params.adjustmentDate);
      const rate = unit.get(params.itemId);
      if (rate !== undefined && rate > 0) currentPurchasePrice = Math.round(rate * 100) / 100;
    }
    
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
      throw new Error('Could not resolve stock context for quantity adjustment.');
    }
    
    if (newQuantity < 0) {
      throw new Error('Quantity cannot go below zero');
    }

    if (params.unitCostOverride != null && quantityChange > 0) {
      currentPurchasePrice = Math.round(Number(params.unitCostOverride) * 10000) / 10000;
    }
    // Calculate value change (quantity_change * unit_cost); FIFO decreases are re-costed from lots below.
    let valueChange = quantityChange * currentPurchasePrice;
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
        reason_code, reason_notes, notes, created_by, stock_count_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
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
        params.createdBy || null,
        params.stockCountId || null,
      ]
    );

    const adjustmentId = adjustmentResult.rows[0].id;

    // Added stock with a batch from the pack: same batch number tops up that batch, a new one is created.
    let batchId: string | null = null;
    if (params.batch && quantityChange > 0) {
      const existingBatch = await client.query<{ id: string }>(
        `SELECT id FROM item_batches
          WHERE business_id = $1 AND item_id = $2 AND variant_id IS NOT DISTINCT FROM $3
            AND batch_number = $4 AND location_id IS NULL
          FOR UPDATE`,
        [params.businessId, params.itemId, params.variantId || null, params.batch.batchNumber]
      );
      if (existingBatch.rows[0]) {
        batchId = existingBatch.rows[0].id;
        await client.query(
          `UPDATE item_batches
              SET quantity = quantity + $1,
                  expiry_date = COALESCE(expiry_date, $2),
                  manufacturing_date = COALESCE(manufacturing_date, $3),
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $4`,
          [quantityChange, params.batch.expiryDate, params.batch.manufacturingDate, batchId]
        );
      } else {
        batchId = (
          await client.query<{ id: string }>(
            `INSERT INTO item_batches (
               business_id, item_id, variant_id, batch_number, manufacturing_date, expiry_date,
               purchase_price, quantity, notes
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [
              params.businessId,
              params.itemId,
              params.variantId || null,
              params.batch.batchNumber,
              params.batch.manufacturingDate,
              params.batch.expiryDate,
              currentPurchasePrice,
              quantityChange,
              `Stock added (${adjustmentNumber})`,
            ]
          )
        ).rows[0].id;
      }
      await client.query(
        `UPDATE items SET track_batch = true, valuation_method = 'fifo' WHERE id = $1 AND business_id = $2`,
        [params.itemId, params.businessId]
      );
    }

    // Create stock movement record with adjustment reference
    // Always include location_id when provided
    await client.query(
      `INSERT INTO stock_movements (
        business_id, item_id, variant_id, location_id, type, quantity,
        reference_type, reference_id, notes, created_by, batch_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        params.businessId,
        params.itemId,
        params.variantId || null,
        params.locationId || null, // Always include location_id when provided
        'adjustment',
        quantityChange,
        params.movementReference?.type ?? 'adjustment',
        params.movementReference?.id ?? adjustmentId,
        `Inventory adjustment: ${params.direction} ${Math.abs(params.quantity)} units. Reason: ${params.reasonCode}`,
        params.createdBy || null,
        batchId,
      ]
    );

    const branchId = adjustmentBranchId || undefined;

    if (fifo && quantityChange < 0) {
      const cost = await fifoCostForDocument(
        client,
        params.businessId,
        new Map([[params.itemId, Math.abs(quantityChange)]]),
        { kind: 'adjustment_out', docId: adjustmentId }
      );
      valueChange = -cost;
    }

    const journalEntryId: string | undefined = undefined;
    const { itcReversed } = await postInventoryAdjustment(client, {
      businessId: params.businessId,
      branchId: branchId ?? null,
      adjustmentId,
      adjustmentNumber,
      date: params.adjustmentDate,
      reason: params.reasonCode,
      isDecrease: params.direction === 'DECREASE',
      amount: valueChange,
      itemId: params.itemId,
      narration: `Inventory adjustment: ${params.direction} ${Math.abs(params.quantity)} units - ${params.reasonCode}`,
      quantityAdjustment: true,
      counterCodes: params.counterCodes,
    });
    await client.query(
      `UPDATE inventory_adjustments SET value_change = $1, gst_impact = $2 WHERE id = $3`,
      [Math.round(valueChange * 100) / 100, itcReversed ? -itcReversed : null, adjustmentId]
    );
    await recostAfterStockChange(client, params.businessId, [params.itemId]);

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
      ? `SELECT v.* FROM item_variants v JOIN items i ON i.id = v.item_id
          WHERE v.id = $1 AND i.business_id = $2 FOR UPDATE OF v`
      : `SELECT * FROM items WHERE id = $1 AND business_id = $2 FOR UPDATE`;
    
    const itemIdToLock = params.variantId || params.itemId;
    const itemResult = await client.query(itemLockQuery, [itemIdToLock, params.businessId]);
    
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
         WHERE id = $2 AND business_id = $3`,
        [newUnitCost, params.itemId, params.businessId]
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

    const journalEntryId: string | undefined = undefined;
    await postInventoryAdjustment(client, {
      businessId: params.businessId,
      branchId: branchId ?? null,
      adjustmentId,
      adjustmentNumber,
      date: params.adjustmentDate,
      reason: params.reasonCode,
      isDecrease: params.valueChange < 0,
      amount: params.valueChange,
      itemId: params.itemId,
      narration: `Inventory value adjustment: ${params.reasonCode}${params.reasonNotes ? ` - ${params.reasonNotes}` : ''}`,
      quantityAdjustment: false,
    });
    await recostAfterStockChange(client, params.businessId, [params.itemId]);

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

