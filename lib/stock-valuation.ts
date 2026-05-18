/**
 * Stock Valuation Library
 * Implements FIFO, LIFO, and Weighted Average valuation methods
 */

import { queryRows, queryOne, getPool } from '@/lib/db';

export type ValuationMethod = 'fifo' | 'lifo' | 'weighted_avg' | 'simple';

export interface BatchAllocation {
  batch_id: string;
  quantity: number;
  unit_cost: number;
}

export interface SerialAllocation {
  serial_id: string;
  serial_number: string;
  unit_cost: number;
}

/**
 * Calculate FIFO valuation for an item
 * Returns batches in order (oldest first) with their costs
 */
export async function calculateFIFOValuation(
  itemId: string,
  quantity: number,
  businessId: string,
  locationId?: string,
  variantId?: string
): Promise<{ allocations: BatchAllocation[]; totalCost: number }> {
  let sql = `
    SELECT id, purchase_price, quantity
    FROM item_batches
    WHERE item_id = $1 AND business_id = $2 AND quantity > 0
  `;
  const params: any[] = [itemId, businessId];

  if (variantId) {
    sql += ` AND variant_id = $${params.length + 1}`;
    params.push(variantId);
  } else {
    sql += ` AND variant_id IS NULL`;
  }

  if (locationId) {
    sql += ` AND (location_id = $${params.length + 1} OR location_id IS NULL)`;
    params.push(locationId);
  }

  sql += ` ORDER BY created_at ASC, manufacturing_date ASC NULLS LAST`;

  const batches = await queryRows<{ id: string; purchase_price: number; quantity: number }>(sql, params);

  const allocations: BatchAllocation[] = [];
  let remainingQty = quantity;
  let totalCost = 0;

  for (const batch of batches) {
    if (remainingQty <= 0) break;

    const batchQty = parseFloat(batch.quantity.toString());
    const allocatedQty = Math.min(remainingQty, batchQty);
    const unitCost = parseFloat(batch.purchase_price.toString());

    allocations.push({
      batch_id: batch.id,
      quantity: allocatedQty,
      unit_cost: unitCost,
    });

    totalCost += allocatedQty * unitCost;
    remainingQty -= allocatedQty;
  }

  if (remainingQty > 0) {
    throw new Error(`Insufficient stock. Need ${quantity}, available ${quantity - remainingQty}`);
  }

  return { allocations, totalCost };
}

/**
 * Calculate LIFO valuation for an item
 * Returns batches in reverse order (newest first) with their costs
 */
export async function calculateLIFOValuation(
  itemId: string,
  quantity: number,
  businessId: string,
  locationId?: string,
  variantId?: string
): Promise<{ allocations: BatchAllocation[]; totalCost: number }> {
  let sql = `
    SELECT id, purchase_price, quantity
    FROM item_batches
    WHERE item_id = $1 AND business_id = $2 AND quantity > 0
  `;
  const params: any[] = [itemId, businessId];

  if (variantId) {
    sql += ` AND variant_id = $${params.length + 1}`;
    params.push(variantId);
  } else {
    sql += ` AND variant_id IS NULL`;
  }

  if (locationId) {
    sql += ` AND (location_id = $${params.length + 1} OR location_id IS NULL)`;
    params.push(locationId);
  }

  sql += ` ORDER BY created_at DESC, manufacturing_date DESC NULLS LAST`;

  const batches = await queryRows<{ id: string; purchase_price: number; quantity: number }>(sql, params);

  const allocations: BatchAllocation[] = [];
  let remainingQty = quantity;
  let totalCost = 0;

  for (const batch of batches) {
    if (remainingQty <= 0) break;

    const batchQty = parseFloat(batch.quantity.toString());
    const allocatedQty = Math.min(remainingQty, batchQty);
    const unitCost = parseFloat(batch.purchase_price.toString());

    allocations.push({
      batch_id: batch.id,
      quantity: allocatedQty,
      unit_cost: unitCost,
    });

    totalCost += allocatedQty * unitCost;
    remainingQty -= allocatedQty;
  }

  if (remainingQty > 0) {
    throw new Error(`Insufficient stock. Need ${quantity}, available ${quantity - remainingQty}`);
  }

  return { allocations, totalCost };
}

/**
 * Calculate Weighted Average valuation for an item
 * Returns average cost per unit
 */
export async function calculateWeightedAverageValuation(
  itemId: string,
  businessId: string,
  locationId?: string,
  variantId?: string
): Promise<number> {
  let sql = `
    SELECT 
      COALESCE(SUM(purchase_price * quantity), 0) as total_cost,
      COALESCE(SUM(quantity), 0) as total_quantity
    FROM item_batches
    WHERE item_id = $1 AND business_id = $2 AND quantity > 0
  `;
  const params: any[] = [itemId, businessId];

  if (variantId) {
    sql += ` AND variant_id = $${params.length + 1}`;
    params.push(variantId);
  } else {
    sql += ` AND variant_id IS NULL`;
  }

  if (locationId) {
    sql += ` AND (location_id = $${params.length + 1} OR location_id IS NULL)`;
    params.push(locationId);
  }

  const result = await queryOne<{ total_cost: number; total_quantity: number }>(sql, params);

  if (!result || parseFloat(result.total_quantity.toString()) === 0) {
    // Fallback to item's purchase_price if no batches
    const item = await queryOne<{ purchase_price: number }>(
      `SELECT purchase_price FROM items WHERE id = $1 AND business_id = $2`,
      [itemId, businessId]
    );
    return item ? parseFloat(item.purchase_price.toString()) : 0;
  }

  const totalCost = parseFloat(result.total_cost.toString());
  const totalQty = parseFloat(result.total_quantity.toString());

  return totalQty > 0 ? totalCost / totalQty : 0;
}

/**
 * Resolves on-hand quantity: warehouse row, else branch_item_stock, else items.current_stock (deprecated aggregate).
 */
export async function resolveItemQuantityForValuation(
  itemId: string,
  businessId: string,
  locationId?: string,
  branchId?: string | null
): Promise<number> {
  if (locationId) {
    const r = await queryOne<{ q: string }>(
      `SELECT COALESCE(current_stock_qty, 0)::text AS q FROM location_stock WHERE location_id = $1 AND item_id = $2`,
      [locationId, itemId]
    );
    return parseFloat(r?.q || '0') || 0;
  }
  if (branchId) {
    const r = await queryOne<{ q: string }>(
      `SELECT COALESCE(quantity, 0)::text AS q FROM branch_item_stock WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`,
      [businessId, branchId, itemId]
    );
    return parseFloat(r?.q || '0') || 0;
  }
  const r = await queryOne<{ q: string }>(
    `SELECT COALESCE(current_stock, 0)::text AS q FROM items WHERE id = $1 AND business_id = $2`,
    [itemId, businessId]
  );
  return parseFloat(r?.q || '0') || 0;
}

/**
 * Get current stock value for an item using specified valuation method
 */
export async function getStockValue(
  itemId: string,
  method: ValuationMethod,
  businessId: string,
  locationId?: string,
  /** When set (non-warehouse mode), quantity comes from branch_item_stock instead of items.current_stock. */
  branchId?: string | null
): Promise<number> {
  if (method === 'simple') {
    const item = await queryOne<{ purchase_price: number }>(
      `SELECT purchase_price FROM items WHERE id = $1 AND business_id = $2`,
      [itemId, businessId]
    );
    if (!item) return 0;
    const qty = await resolveItemQuantityForValuation(itemId, businessId, locationId, branchId);
    return qty * parseFloat(item.purchase_price.toString());
  }

  if (method === 'weighted_avg') {
    const avgCost = await calculateWeightedAverageValuation(itemId, businessId, locationId);
    const qty = await resolveItemQuantityForValuation(itemId, businessId, locationId, branchId);
    return qty * avgCost;
  }

  // For FIFO/LIFO, calculate based on all batches
  let sql = `
    SELECT purchase_price, quantity
    FROM item_batches
    WHERE item_id = $1 AND business_id = $2 AND quantity > 0
  `;
  const params: any[] = [itemId, businessId];

  if (locationId) {
    sql += ` AND location_id = $3`;
    params.push(locationId);
  }

  sql += method === 'fifo'
    ? ` ORDER BY created_at ASC, manufacturing_date ASC NULLS LAST`
    : ` ORDER BY created_at DESC, manufacturing_date DESC NULLS LAST`;

  const batches = await queryRows<{ purchase_price: number; quantity: number }>(sql, params);

  let totalValue = 0;
  for (const batch of batches) {
    const qty = parseFloat(batch.quantity.toString());
    const cost = parseFloat(batch.purchase_price.toString());
    totalValue += qty * cost;
  }

  return totalValue;
}

/**
 * Allocate stock on sale based on valuation method
 * Returns batch/serial allocations
 */
export async function allocateStockOnSale(
  itemId: string,
  quantity: number,
  method: ValuationMethod,
  businessId: string,
  locationId?: string,
  trackSerial?: boolean,
  variantId?: string
): Promise<{
  batchAllocations: BatchAllocation[];
  serialAllocations?: SerialAllocation[];
  totalCost: number;
}> {
  if (trackSerial) {
    // For serial tracking, allocate specific serials
    let sql = `
      SELECT id, serial_number, purchase_price
      FROM item_serials
      WHERE item_id = $1 AND business_id = $2 AND status = 'available'
    `;
    const params: any[] = [itemId, businessId];

    if (variantId) {
      sql += ` AND variant_id = $${params.length + 1}`;
      params.push(variantId);
    } else {
      sql += ` AND variant_id IS NULL`;
    }

    if (locationId) {
      sql += ` AND (location_id = $${params.length + 1} OR location_id IS NULL)`;
      params.push(locationId);
    }

    sql += ` ORDER BY created_at ASC LIMIT $${params.length + 1}`;
    params.push(quantity);

    const serials = await queryRows<{ id: string; serial_number: string; purchase_price: number }>(sql, params);

    if (serials.length < quantity) {
      throw new Error(`Insufficient serial numbers. Need ${quantity}, available ${serials.length}`);
    }

    const serialAllocations: SerialAllocation[] = serials.map((s) => ({
      serial_id: s.id,
      serial_number: s.serial_number,
      unit_cost: parseFloat(s.purchase_price.toString()),
    }));

    const totalCost = serialAllocations.reduce((sum, s) => sum + s.unit_cost, 0);

    return {
      batchAllocations: [],
      serialAllocations,
      totalCost,
    };
  }

  // For batch tracking or simple valuation
  if (method === 'fifo') {
    const result = await calculateFIFOValuation(itemId, quantity, businessId, locationId, variantId);
    return {
      batchAllocations: result.allocations,
      totalCost: result.totalCost,
    };
  }

  if (method === 'lifo') {
    const result = await calculateLIFOValuation(itemId, quantity, businessId, locationId, variantId);
    return {
      batchAllocations: result.allocations,
      totalCost: result.totalCost,
    };
  }

  // Weighted average or simple
  const avgCost = await calculateWeightedAverageValuation(itemId, businessId, locationId, variantId);
  return {
    batchAllocations: [],
    totalCost: quantity * avgCost,
  };
}

/**
 * Allocate stock on purchase - create batches/serials
 */
export async function allocateStockOnPurchase(
  itemId: string,
  quantity: number,
  unitCost: number,
  businessId: string,
  purchaseId: string,
  locationId?: string,
  supplierId?: string,
  batchNumber?: string,
  serialNumbers?: string[],
  manufacturingDate?: string,
  expiryDate?: string
): Promise<{
  batchId?: string;
  serialIds: string[];
}> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const serialIds: string[] = [];

    // Check if item tracks serials
    const item = await queryOne<{ track_serial: boolean; track_batch: boolean }>(
      `SELECT track_serial, track_batch FROM items WHERE id = $1 AND business_id = $2`,
      [itemId, businessId]
    );

    if (!item) {
      throw new Error('Item not found');
    }

    if (item.track_serial && serialNumbers && serialNumbers.length > 0) {
      // Create serial numbers
      for (const serialNumber of serialNumbers) {
        const result = await client.query(
          `INSERT INTO item_serials (
            business_id, item_id, serial_number, purchase_price,
            location_id, supplier_id, purchase_id, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'available')
          RETURNING id`,
          [businessId, itemId, serialNumber, unitCost, locationId || null, supplierId || null, purchaseId]
        );
        serialIds.push(result.rows[0].id);
      }
    }

    let batchId: string | undefined;

    if (item.track_batch) {
      // Create or update batch
      if (batchNumber) {
        const existing = await client.query(
          `SELECT id FROM item_batches 
           WHERE item_id = $1 AND batch_number = $2 AND location_id IS NOT DISTINCT FROM $3`,
          [itemId, batchNumber, locationId || null]
        );

        if (existing.rows.length > 0) {
          // Update existing batch
          const result = await client.query(
            `UPDATE item_batches
             SET quantity = quantity + $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
             RETURNING id`,
            [quantity, existing.rows[0].id]
          );
          batchId = result.rows[0].id;
        } else {
          // Create new batch
          const result = await client.query(
            `INSERT INTO item_batches (
              business_id, item_id, batch_number, purchase_price, quantity,
              location_id, supplier_id, purchase_id,
              manufacturing_date, expiry_date
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id`,
            [
              businessId,
              itemId,
              batchNumber,
              unitCost,
              quantity,
              locationId || null,
              supplierId || null,
              purchaseId,
              manufacturingDate || null,
              expiryDate || null,
            ]
          );
          batchId = result.rows[0].id;
        }
      }
    }

    await client.query('COMMIT');

    return { batchId, serialIds };
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

